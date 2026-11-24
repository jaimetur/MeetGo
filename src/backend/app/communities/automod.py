"""The moderation bot of the communities (bot-moderator).

It reads what people write in a community (chat messages, board posts and comments) against the community's rules
with Claude. When something breaks a rule it is removed and the author gets the next sanction of the ladder: a ban of
6 hours, then 24 hours, then a ban for good. The bot says so in the community chat and tells the person. Only an
admin of the community lifts a ban. Without a Claude API key (administration or ANTHROPIC_API_KEY) the rules are not checked.
"""

import json
import logging

import anthropic
from sqlalchemy import select

from app.core import ai
from app.core.db import SessionLocal
from app.core.i18n import t, use_lang
from app.core.models import BoardComment, BoardPost, Conversation, Message, User, utcnow
from app.communities.service import bot_ids, sanction
from app.conversations.service import get_membership

logger = logging.getLogger("meetgo.automod")

SYSTEM = (
    "You are the moderation bot of a community in MeetGo, a social app where people of the same area chat and meet up. "
    "You receive the community's rules and one thing a member wrote (a chat message, a board post or a comment). "
    "Decide whether it clearly breaks one of the rules. Flag only clear breaches: jokes, disagreement, everyday "
    "language and harmless off-topic messages are fine, and when in doubt it is not a breach. "
    "If it is a breach, `rule` is the rule it breaks, quoted as written, and `reason` says why in one short sentence "
    "in the language of the rules. If not, both are empty strings."
)
VERDICT = {
    "type": "object",
    "properties": {
        "violation": {"type": "boolean"},
        "rule": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["violation", "rule", "reason"],
    "additionalProperties": False,
}

# The regular expressions of messaging/moderation.py that count as breaking the rules.
RULE_REASONS = ("TOXICITY", "PHONE_NOT_ALLOWED", "LINKS_NOT_ALLOWED")


def enabled() -> bool:
    return bool(ai.api_key())


def _api() -> anthropic.AsyncAnthropic:
    return ai.client()


async def judge(rules: str, text: str) -> dict | None:
    """Claude's verdict {violation, rule, reason}, or None when it could not decide (nothing is done then)."""
    try:
        response = await _api().beta.messages.create(
            model=ai.model(),
            max_tokens=4096,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": VERDICT}},
            system=SYSTEM,
            messages=[{"role": "user", "content": f"<rules>\n{rules.strip()}\n</rules>\n\n<written>\n{text.strip()}\n</written>"}],
        )
    except anthropic.RateLimitError:
        logger.warning("Moderation bot: rate limited, not checked")
        return None
    except anthropic.APIStatusError as e:
        logger.warning("Moderation bot: API error %s: %s", e.status_code, e.message)
        return None
    except anthropic.APIConnectionError:
        logger.warning("Moderation bot: cannot reach the API")
        return None
    if response.stop_reason == "refusal":
        return None
    out = next((b.text for b in response.content if b.type == "text"), None)
    try:
        verdict = json.loads(out) if out else None
    except ValueError:
        return None
    return verdict if isinstance(verdict, dict) else None


def _needs_check(conv: Conversation | None) -> bool:
    return bool(enabled() and conv and conv.kind == "channel" and (conv.rules_markdown or "").strip())


async def _exempt(db, conv_id: int, user_id: int | None) -> bool:
    """Staff, bots and MeetGo's administrators are not checked."""
    if not user_id:
        return True
    user = await db.get(User, user_id)
    member = await get_membership(db, conv_id, user_id)
    return bool(not user or user.role == "admin" or user.bot_role or not member
                or member.role in ("owner", "admin", "moderator"))


async def punish(db, conv: Conversation, user_id: int, rule: str) -> None:
    """The next sanction of the ladder for `user_id`, said in the community chat and to the person. Commits."""
    from app.messaging.service import send_message
    from app.push.service import push_notice
    from app.realtime import service as realtime

    member = await get_membership(db, conv.id, user_id)
    target = await db.get(User, user_id)
    if not member or member.banned or not target:
        await db.commit()
        return
    hours = sanction(member)
    await db.commit()
    realtime.invalidate_members(conv.id)
    if hours is None:
        await realtime.publish([user_id], {"type": "membership.removed", "conversation_id": conv.id})
    await realtime.publish([user_id], {"type": "conversation.changed", "conversation_id": conv.id})

    bots = await bot_ids(db)
    bot = await db.get(User, bots.get("moderator")) if bots.get("moderator") else None
    bot_member = await get_membership(db, conv.id, bot.id) if bot else None
    params = {"name": target.display_name, "hours": hours or 0, "rule": rule.strip()[:200] or "—"}
    if bot and bot_member:
        with use_lang(target.lang):
            body = t("bot_banned_hours" if hours else "bot_banned_forever", params)
        try:
            await send_message(db, conv, bot_member, bot, body=body)
        except Exception:  # the sanction stands even if the notice cannot be written
            logger.exception("Moderation bot: could not post the notice")
    push_notice([target], "community.banned", "email_banned_hours" if hours else "email_banned_forever", params,
                f"/app/communities/{conv.id}")


async def check_message(conv_id: int, msg_id: int) -> None:
    await ai.refresh_if_stale()
    async with SessionLocal() as db:
        conv = await db.get(Conversation, conv_id)
        msg = await db.get(Message, msg_id)
        if not _needs_check(conv) or not msg or msg.deleted_at or not (msg.body or "").strip():
            return
        if await _exempt(db, conv_id, msg.sender_id):
            return
        verdict = await judge(conv.rules_markdown, msg.body)
        if not verdict or not verdict.get("violation"):
            return
        from app.messaging.service import recipients
        from app.realtime import service as realtime
        await db.refresh(msg)
        if msg.deleted_at:
            return
        msg.deleted_at = utcnow()
        msg.moderation_reason = "RULES"
        await db.commit()
        await realtime.publish(await recipients(db, conv_id), {
            "type": "message.deleted", "conversation_id": conv_id, "message_id": msg.id,
            "thread_root_id": msg.thread_root_id, "moderation_reason": "RULES"})
        await punish(db, conv, msg.sender_id, verdict.get("rule") or "")


async def check_post(post_id: int) -> None:
    await ai.refresh_if_stale()
    async with SessionLocal() as db:
        post = await db.get(BoardPost, post_id)
        conv = await db.get(Conversation, post.conversation_id) if post else None
        if not post or post.deleted_at or not _needs_check(conv) or await _exempt(db, conv.id, post.author_id):
            return
        verdict = await judge(conv.rules_markdown, f"{post.title}\n\n{post.body or ''}{(chr(10) + post.place) if post.place else ''}")
        if not verdict or not verdict.get("violation"):
            return
        from app.board.service import delete_post_data
        from app.messaging.service import recipients
        from app.realtime import service as realtime
        await db.refresh(post)
        if post.deleted_at:
            return
        await delete_post_data(db, post)
        await db.commit()
        await realtime.publish(await recipients(db, conv.id), {"type": "post.deleted", "community_id": conv.id, "post_id": post.id})
        await punish(db, conv, post.author_id, verdict.get("rule") or "")


async def check_comment(comment_id: int) -> None:
    await ai.refresh_if_stale()
    async with SessionLocal() as db:
        comment = await db.get(BoardComment, comment_id)
        post = await db.get(BoardPost, comment.post_id) if comment else None
        conv = await db.get(Conversation, post.conversation_id) if post else None
        if not comment or not _needs_check(conv) or await _exempt(db, conv.id, comment.author_id):
            return
        verdict = await judge(conv.rules_markdown, comment.body)
        if not verdict or not verdict.get("violation"):
            return
        from app.messaging.service import recipients
        from app.realtime import service as realtime
        author_id = comment.author_id
        await db.delete(comment)
        await db.commit()
        await realtime.publish(await recipients(db, conv.id), {
            "type": "comment.deleted", "community_id": conv.id, "post_id": post.id, "comment_id": comment_id})
        await punish(db, conv, author_id, verdict.get("rule") or "")
