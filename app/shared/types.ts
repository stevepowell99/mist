export interface UserInfo {
  name: string;
  color: string;
  colorLight: string;
}

export type DocMode = "edit" | "suggest";

/** Access level granted by the secret link used to open a document */
export type DocRole = "edit" | "suggest";

export interface ThreadReply {
  id: string;
  author: UserInfo;
  text: string;
  createdAt: number;
}

export interface ThreadData {
  id: string;
  commentText: string;
  highlightText?: string;
  author: UserInfo;
  createdAt: number;
  resolved: boolean;
  replies: ThreadReply[];
}

export interface CapturedSelection {
  from: number;
  to: number;
  text: string;
}
