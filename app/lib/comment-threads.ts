import type { ThreadData } from "~/shared/types";

export interface DocumentComment {
  commentText: string;
  highlightText?: string;
  position: number;
  endPosition: number;
}

export type MatchedThread = ThreadData & { position?: number; endPosition?: number };

export function matchThreadsToComments(
  threads: ThreadData[],
  comments: DocumentComment[],
): MatchedThread[] {
  const sorted = [...threads].sort((a, b) => a.createdAt - b.createdAt);
  const usedCommentIndices = new Set<number>();
  const result: MatchedThread[] = [];

  for (const thread of sorted) {
    let matchedIdx = -1;
    for (let i = 0; i < comments.length; i++) {
      if (usedCommentIndices.has(i)) continue;
      if (comments[i].commentText === thread.commentText) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx >= 0) {
      usedCommentIndices.add(matchedIdx);
      result.push({
        ...thread,
        position: comments[matchedIdx].position,
        endPosition: comments[matchedIdx].endPosition,
      });
    } else {
      result.push({ ...thread, position: undefined, endPosition: undefined });
    }
  }

  return result;
}

export function findOrphanedThreads(
  threads: ThreadData[],
  comments: DocumentComment[],
): ThreadData[] {
  const matched = matchThreadsToComments(threads, comments);
  return matched
    .filter((t) => t.position === undefined)
    .map(({ position: _, ...rest }) => rest);
}
