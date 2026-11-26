// Plans: the meetups and events I go to or organise, and the right column of the web.
import React, { useEffect, useState } from "react";
import { t } from "@lang";
import { api } from "../api";
import { coverColor, coverGradient, dateTile, hourOf, onBoardEvent, relative, shortDay } from "../board";
import { chatPath, communityPath, navigate, postPath } from "../router";
import { useStore } from "../store";
import type { Post } from "../types";
import { Icon, communityCover, communityTint, hobbyIcon } from "./common";
import { EmptyState, KindTag, PhoneTop, placesText } from "./Board";

type Tab = "upcoming" | "organizing" | "past";

function PlanRow({ post, tab }: { post: Post; tab: Tab }) {
  const unread = useStore((s) => (post.chat_conversation_id ? s.conversations[post.chat_conversation_id]?.unread_count || 0 : 0));
  const d = post.starts_at ? dateTile(post.starts_at) : null;
  const status = post.my_status === "waitlist" ? t("ui_post_on_waitlist") : post.my_status === "pending" ? t("ui_post_request_sent") : null;
  return (
    <div className="planrow" role="link" tabIndex={0} onClick={() => navigate(postPath(post.id))} onKeyDown={(e) => e.key === "Enter" && navigate(postPath(post.id))}>
      <span className="plantile" style={{ background: coverGradient("p" + post.id), ["--cc" as string]: coverColor("p" + post.id) }}>
        {d ? <><small>{d.weekday}</small><b>{d.day}</b></> : <Icon name="calendar" />}
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="planname">{post.title}</div>
        <div className="plansub">
          {post.starts_at ? `${shortDay(post.starts_at)} · ${hourOf(post.starts_at)}` : ""}
          {post.starts_at && tab !== "past" ? ` · ${relative(post.starts_at)}` : ""}
        </div>
        <div className="plansub">
          <KindTag kind={post.kind} /> <span>{post.community.title}</span> · <span>{placesText(post)}</span>
          {status ? <span className="spill wait" style={{ marginLeft: 6 }}>{status}</span> : null}
        </div>
      </div>
      {tab === "past" ? (
        <button className="btn sm" onClick={(e) => { e.stopPropagation(); navigate(`/publish?repeat=${post.id}`); }}><Icon name="repeat" size="sm" />{t("ui_post_repeat")}</button>
      ) : post.chat_conversation_id ? (
        <button className="iconbtn chatbtn" aria-label={t("ui_post_open_chat")} title={t("ui_post_open_chat")} onClick={(e) => { e.stopPropagation(); navigate(chatPath(post.chat_conversation_id!)); }}>
          <Icon name="chat" />{unread ? <span className="bdg dotbdg">{unread > 99 ? "99+" : unread}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

/** Groups upcoming plans by "This week" and "Later". */
function sections(list: Post[], tab: Tab): [string, Post[]][] {
  if (tab === "past") return [["", list]];
  const weekEnd = Date.now() + 7 * 86400000;
  const soon = list.filter((p) => p.starts_at && new Date(p.starts_at).getTime() < weekEnd);
  const later = list.filter((p) => !soon.includes(p));
  return [[t("ui_plans_this_week"), soon], [t("ui_plans_later"), later]];
}

export function PlansPage() {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [lists, setLists] = useState<Partial<Record<Tab, Post[] | null>>>({});
  const [error, setError] = useState<string | null>(null);

  const load = (which: Tab) => {
    setError(null);
    api.myPlans(which).then((posts) => {
      const sorted = [...posts].sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""));
      if (which === "past") sorted.reverse();
      setLists((l) => ({ ...l, [which]: sorted }));
    }).catch((e) => {
      setLists((l) => ({ ...l, [which]: [] }));
      if (e?.status !== 404) setError(e.message);
    });
  };
  useEffect(() => {
    load(tab);
  }, [tab]);
  useEffect(() => onBoardEvent((ev) => {
    if (ev.type !== "comment.created") load(tab);
  }), [tab]);

  const list = lists[tab];
  const tabs: [Tab, string][] = [["upcoming", t("ui_plans_going")], ["organizing", t("ui_plans_organising")], ["past", t("ui_plans_past")]];
  const empty = {
    upcoming: <EmptyState icon="calendar" title={t("ui_plans_empty_going_title")} body={t("ui_plans_empty_going_body")} action={t("ui_plans_browse_board")} onAction={() => navigate("/")} />,
    organizing: <EmptyState icon="users" title={t("ui_plans_empty_org_title")} body={t("ui_plans_empty_org_body")} action={t("ui_board_publish_plan")} onAction={() => navigate("/publish")} />,
    past: <EmptyState icon="clock" title={t("ui_plans_empty_past_title")} body={t("ui_plans_empty_past_body")} />,
  }[tab];

  return (
    <main className="screen">
      <PhoneTop title={t("ui_nav_plans")} />
      <div className="swrap">
        <header className="shead deskonly">
          <div className="grow"><h1>{t("ui_plans_title")}</h1><p className="muted">{t("ui_plans_lead")}</p></div>
          <button className="btn go" onClick={() => navigate("/publish")}><Icon name="plus" size="sm" />{t("ui_nav_publish")}</button>
        </header>
        <div className="segtabs" role="tablist">
          {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        {!list ? (
          <div className="box">{[0, 1, 2].map((i) => <div key={i} className="planrow skel"><span className="plantile shimmer" /><div className="grow"><span className="sk w60 h18" /><span className="sk w30" /></div></div>)}</div>
        ) : error ? (
          <EmptyState icon="info" title={t("ui_board_error")} body={error} action={t("ui_board_retry")} onAction={() => load(tab)} />
        ) : !list.length ? empty : (
          sections(list, tab).map(([label, xs]) => xs.length ? (
            <section key={label || "all"} className="plansec">
              {label ? <div className="lsec">{label}</div> : null}
              <div className="box planbox">{xs.map((p) => <PlanRow key={p.id} post={p} tab={tab} />)}</div>
            </section>
          ) : null)
        )}
      </div>
    </main>
  );
}

/** Web: "Your next plans" and "Your communities" beside the board. */
export function RightColumn() {
  const plans = useStore((s) => s.myPlans);
  const communities = useStore((s) => s.myCommunities);
  const conversations = useStore((s) => s.conversations);
  const activity = (c: { conversation_id: number }) => {
    const at = conversations[c.conversation_id]?.last_message_at;
    return at ? new Date(at).getTime() : 0;
  };
  return (
    <aside className="rcol" aria-label={t("ui_side_panel")}>
      <section>
        <div className="row"><h3 className="grow">{t("ui_plans_next")}</h3><button className="linkbtn" onClick={() => navigate("/plans")}>{t("ui_post_see_all")}</button></div>
        {plans === null ? <div className="mini skel"><span className="sk w60" /><span className="sk w30" /></div> : null}
        {plans?.slice(0, 4).map((p) => {
          const d = p.starts_at ? dateTile(p.starts_at) : null;
          return (
            <button key={p.id} className="mini" onClick={() => navigate(postPath(p.id))}>
              <span className="minitile" style={{ background: coverGradient("p" + p.id), ["--cc" as string]: coverColor("p" + p.id) }}>{d ? <><small>{d.weekday}</small><b>{d.day}</b></> : null}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <b>{p.title}</b>
                <span className="muted">{p.starts_at ? hourOf(p.starts_at) + " · " : ""}{p.my_status === "waitlist" ? t("ui_post_on_waitlist") : placesText(p)}</span>
              </span>
            </button>
          );
        })}
        {plans && !plans.length ? (
          <div className="mini empty-mini">
            <span className="muted">{t("ui_plans_next_empty")}</span>
            <button className="linkbtn" onClick={() => navigate("/")}>{t("ui_plans_browse_board")}</button>
          </div>
        ) : null}
      </section>
      <section>
        <div className="row"><h3 className="grow">{t("ui_community_yours")}</h3><button className="linkbtn" onClick={() => navigate("/communities")}>{t("ui_post_see_all")}</button></div>
        {communities === null ? <div className="mini skel"><span className="sk w60" /></div> : null}
        {/* the latest active first (last message in its chat), then by name; each with a shortcut to publish in it */}
        {[...(communities || [])].sort((a, b) => (activity(b) - activity(a)) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" })).map((c) => (
          <div key={c.id} className="minirow">
            <button className="mini" onClick={() => navigate(communityPath(c.id))}>
              <span className="minitile round" style={{ background: communityCover(c.slug, "c" + c.id), ...communityTint(c.slug, "c" + c.id) }}><Icon name={hobbyIcon(c.slug, c.title)} /></span>
              <span className="grow" style={{ minWidth: 0 }}>
                <b>{c.title}</b>
                <span className="muted">
                  {c.online_count ? <><span className="odot" />{t("ui_community_online_n", { n: c.online_count })}</> : t("ui_members_n", { n: c.member_count })}
                  {c.upcoming_count ? ` · ${t("ui_community_plans_n", { n: c.upcoming_count })}` : ""}
                </span>
              </span>
            </button>
            <button className="minipub" title={t("ui_community_publish_here", { name: c.title })} aria-label={t("ui_community_publish_here", { name: c.title })}
              onClick={() => navigate(`/publish?community=${c.id}`)}><Icon name="plus" /></button>
          </div>
        ))}
        {communities && !communities.length ? (
          <div className="mini empty-mini">
            <span className="muted">{t("ui_community_none_yet")}</span>
            <button className="linkbtn" onClick={() => navigate("/communities")}>{t("ui_board_find_communities")}</button>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
