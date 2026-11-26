/** display_name is how the person is shown ("Jaime (jaimetur)"); username is the alias, for @mentions. */
export type UserSummary = { id: number; display_name: string; username?: string | null; avatar_url?: string | null };

export type Me = UserSummary & {
  first_name?: string | null;
  last_name?: string | null;
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
  bot_role?: string | null;
  email_verified: boolean;
  dob_change_count: number;
  email_prefs?: Record<string, boolean>;
  read_receipts?: boolean;
  last_seen_privacy?: "all" | "friends" | "nobody";
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
  voice?: boolean;
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
  min_age?: number | null;
  max_age?: number | null;
  read_only?: boolean;  // expelled by a change of the community's filters: the chat stays, read only
  archive?: { until: string; community_id: number | null } | null;  // a zone joined into a wider community: read only until then
  interest: { id: number; slug: string; name: string } | null;
  other_user: (UserSummary & { online: boolean; last_seen_at?: string | null }) | null;
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
  plan?: { post_id: number; kind: "meetup" | "event"; community_id: number } | null;  // the chat of a plan or event
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

export type Interest = {
  id: number; slug: string; name: string;
  category?: string | null; icon?: string | null; color?: string | null; age_ranges?: string[]; active?: boolean;
};

// ---- communities, board and plans (docs/COMMUNITIES.md) ----
export type AccessMode = "open" | "request" | "invite";
export type BoardMode = "open" | "admins";
export type CommunityRole = "owner" | "admin" | "moderator" | "member";

export type Community = {
  id: number;
  kind: "interest" | "custom";
  category?: string | null;  // its category's key (interest communities: set in the administration, or none)
  language?: string | null;  // its official language (by default, its zone's)
  title: string;
  slug: string | null;
  description: string | null;
  avatar_url: string | null;
  province: string;
  age_range: string;
  access_mode: AccessMode;
  board_mode: BoardMode;
  member_count: number;
  online_count: number;
  joined: boolean;
  role: CommunityRole | null;
  request_pending: boolean;
  upcoming_count: number;
  conversation_id: number;
  rules?: string | null;
  invite_code?: string | null;
  ban_until?: string | null;
  my_zone?: boolean;
  min_age?: number | null;
  max_age?: number | null;
  join_questions?: string[];
  retention_days?: number | null;
  tags?: string[];
  matches?: string[];
  created_at: string;
};

export type CommunityStats = {
  members: number; new_30d: number; joined_by_week: { week: string; count: number }[]; messages_30d: number; active_30d: number;
  plans_upcoming: number; plans_90d: number; attendance: { marked: number; came: number; rate: number | null };
  rating: { average: number | null; count: number }; top_organisers: { user: UserSummary; plans: number }[];
};

export type CommunityMember = UserSummary & { role: CommunityRole; online: boolean; bot?: boolean; ban_until?: string | null; strikes?: number };

export type PostKind = "thread" | "meetup" | "event" | "notice";
export type CommentsMode = "all" | "attendees" | "off";
export type AttendStatus = "going" | "waitlist" | "pending";

export type Post = {
  id: number;
  community: { id: number; title: string; slug: string | null };
  kind: PostKind;
  author: UserSummary;
  title: string;
  body: string | null;
  starts_at: string | null;
  ends_at: string | null;
  place: string | null;
  place_url: string | null;
  capacity: number | null;
  going_count: number;
  waitlist_count: number;
  link_url: string | null;
  cover_url: string | null;
  cover_art?: string | null;  // a gallery illustration (/covers/<name>.svg) when there is no photo
  comments_mode: CommentsMode;
  join_mode: "open" | "approval";
  comment_count: number;
  pinned: boolean;
  closed: boolean;
  my_status: AttendStatus | null;
  can_comment: boolean;
  can_edit: boolean;
  chat_conversation_id: number | null;
  attendees?: UserSummary[];
  mode?: "in_person" | "online" | "hybrid";
  online_url?: string | null;
  has_online_url?: boolean;
  max_guests?: number;
  my_guests?: number;
  series?: { id: number; freq: "weekly" | "biweekly" | "monthly"; until: string | null; ended: boolean } | null;
  cohosts?: UserSummary[];
  my_rating?: number | null;
  rating?: { average: number; count: number } | null;
  calendar_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type PostPage = { posts: Post[]; has_more: boolean };
export type Attendee = UserSummary & { status: AttendStatus; guests?: number; attended?: boolean | null };
export type Comment = { id: number; post_id: number; author: UserSummary; body: string; created_at: string; can_delete: boolean };
export type FeedFilter = { kind?: PostKind | "plan"; when?: "all" | "today" | "weekend" | "week" | "upcoming" | "past"; community_id?: number; before_id?: number; limit?: number };

/** A post of someone's wall (Inicio → My wall / My friends). */
export type FeedMedia = { id: number; file_name: string; mime: string; size: number; width: number | null; height: number | null; url: string; thumb_url: string | null };
export type FeedPost = {
  id: number; author: UserSummary; body: string; audience: "friends" | "followers" | "public"; place: string | null;
  created_at: string; edited: boolean; media: FeedMedia[]; shared_from_id: number | null; shared: FeedPost | null;
  reactions: Record<string, number>; my_reaction: string | null; comments: number; shares: number; saved: boolean; mine: boolean;
};
export type FeedComment = { id: number; post_id: number; parent_id: number | null; author: UserSummary; body: string; created_at: string; mine: boolean };
/** A story (24 hours) and the stories of one person, as the strip shows them. */
/** A song of the library, for stories. */
export type MusicTrack = { id: number; kind: "classic" | "mood"; mood: string | null; title: string; artist: string; performer: string;
  url: string; duration: number; license: string; license_url: string | null; source_url: string | null };
/** Where a story's text goes and how it looks, its emoji stickers and its filter (positions from 0 to 1). */
export type StoryLayout = {
  text?: { x: number; y: number; size: number; color: string; font: string; bg: string; align: "left" | "center" | "right" };
  stickers?: { e: string; x: number; y: number; size: number }[];
  filter?: string;
};
export type StoryItem = {
  id: number; kind: "photo" | "video" | "text"; text: string; bg: string | null; media: FeedMedia | null;
  layout?: StoryLayout; music?: (MusicTrack & { start: number }) | null;
  created_at: string; expires_at: string; seen: boolean; my_reaction: string | null; views: number | null; audience: string | null;
};
export type StoryGroup = { user: UserSummary; mine: boolean; stories: StoryItem[]; all_seen: boolean; last_at: string };
