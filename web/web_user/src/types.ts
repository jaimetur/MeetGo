export type UserSummary = { id: number; display_name: string; avatar_url?: string | null };

export type Me = UserSummary & {
  email?: string | null;
  phone?: string | null;
  province: string;
  country?: string | null;
  city?: string | null;
  dob: string;
  age_range: string;
  accept_dm: boolean;
  bio?: string | null;
  role: string;
  email_verified: boolean;
  dob_change_count: number;
  email_prefs?: Record<string, boolean>;
};

export type Kind = "channel" | "group" | "dm";

export type LastMessage = {
  id: number;
  kind: string;
  sender_id: number | null;
  sender_name: string | null;
  body: string;
  deleted: boolean;
  has_attachments: boolean;
  created_at: string;
};

export type Conversation = {
  id: number;
  kind: Kind;
  title: string;
  slug: string | null;
  subtitle: string | null;
  avatar_url: string | null;
  province: string | null;
  age_range: string | null;
  interest: { id: number; slug: string; name: string } | null;
  other_user: (UserSummary & { online: boolean }) | null;
  role: string;
  notify: "all" | "mentions" | "none";
  muted_until: string | null;
  pinned: boolean;
  banned: boolean;
  silenced_until: string | null;
  last_read_message_id: number;
  last_message_at: string | null;
  slow_mode_seconds: number;
  pinned_message_id: number | null;
  description: string | null;
  member_count: number;
  unread_count: number;
  mention_count: number;
  last_message: LastMessage | null;
  rules_markdown?: string;
  invite_code?: string | null;
  pinned_message?: Message | null;
};

export type Attachment = {
  id: number;
  file_name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  thumb_url: string | null;
};

export type Reaction = { emoji: string; count: number; user_ids: number[]; me?: boolean };

export type Message = {
  id: number;
  conversation_id: number;
  client_id: string | null;
  kind: "text" | "system";
  sender: UserSummary | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  moderation_reason: string | null;
  reply_to: { id: number; sender_name: string | null; body: string; deleted: boolean } | null;
  thread_root_id: number | null;
  also_in_channel: boolean;
  thread: { count: number; last_reply_at: string | null; participants: UserSummary[] } | null;
  mentions: number[];
  reactions: Reaction[];
  attachments: Attachment[];
  // Client-side only
  pending?: boolean;
  failed?: boolean;
};

export type Member = UserSummary & { role: string; online: boolean; silenced_until: string | null };

export type BillingStatus = {
  active: boolean;
  required: boolean;
  source: "free" | "grant" | "stripe" | "play" | null;
  grant: { source: string; until: string | null } | null;
  stripe: { plan: string; status: string; period_end: string | null; cancel_at_period_end: boolean } | null;
  play: { plan: string | null; state: string; expiry: string | null } | null;
};

export type Plans = {
  enabled: boolean;
  trial_days: number;
  currency: string;
  plans: { id: "monthly" | "yearly"; amount: number; interval: string }[];
  stripe: boolean;
  play: { enabled: boolean; product: string; store_url: string };
};

export type Interest = { id: number; slug: string; name: string };
