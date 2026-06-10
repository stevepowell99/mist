import { data, Link } from "react-router";
import type { Route } from "./+types/docs.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import type { DocRole, GitHubMeta } from "~/shared/types";
import { getCloudflare } from "~/lib/cloudflare.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import PreviewToggle from "~/components/PreviewToggle";
import ConnectionStatus from "~/components/ConnectionStatus";
import UserName from "~/components/UserName";
import ShareButton from "~/components/ShareButton";
import ModeToggle from "~/components/ModeToggle";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionActions from "~/components/SuggestionActions";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import ThemeSelector from "~/components/ThemeSelector";
import MobilePanel from "~/components/MobilePanel";
import OnboardingBanner from "~/components/OnboardingBanner";
import NamePrompt from "~/components/NamePrompt";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "mist" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }

  const docKey = new URL(request.url).searchParams.get("k");
  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(
    new Request(`https://do/?k=${encodeURIComponent(docKey ?? "")}`),
  );
  const { exists, createdAt, role, suggestKey, github } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
    role: DocRole | null;
    suggestKey?: string;
    github: GitHubMeta | null;
  };

  if (!exists || !role) {
    throw data(null, { status: 404 });
  }

  return { id, createdAt, role, suggestKey: suggestKey ?? null, docKey, github };
}

export default function DocumentPage({ loaderData }: Route.ComponentProps) {
  const { id, createdAt, role, suggestKey, docKey, github } = loaderData;
  const yjs = useYjsEditor(id, docKey);

  return (
    <DocumentProvider
      docId={id}
      createdAt={createdAt}
      yjs={yjs}
      role={role}
      docKey={docKey}
      suggestKey={suggestKey}
      github={github}
    >
      <DocumentLayout id={id} />
    </DocumentProvider>
  );
}

function DocumentLayout({ id }: { id: string }) {
  const {
    yjs,
    showPreview,
    handleEditorReady,
    handleCommentClick,
    commentHighlight,
    activeCommentRange,
    cleanView,
    openCommentInput,
    handleResolveAtCursor,
    handleDeleteAtCursor,
    mode,
    role,
    github,
  } = useDocument();

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
        <Link
          to="/"
          className="flex items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          mist
        </Link>
        <div className="flex grow shrink-0 items-center px-4">
          <span className="font-mono font-bold">{id}</span>
        </div>
        <div className="flex shrink-0 items-center border-l border-border px-3">
          <ConnectionStatus />
        </div>
        <div className="flex shrink-0 items-center border-l border-border">
          <UserName />
        </div>
        <div className="shrink-0 border-l border-border">
          <ShareButton />
        </div>
        <div className="flex shrink-0 items-center border-l border-border">
          <ThemeSelector />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-[33vh] lg:border-r lg:border-border lg:pb-0">
          <Editor
            yjs={yjs}
            forceSuggest={role === "suggest"}
            github={github}
            hidden={showPreview}
            onEditorReady={handleEditorReady}
            onCommentClick={handleCommentClick}
            commentHighlight={commentHighlight}
            activeCommentRange={activeCommentRange}
            cleanView={cleanView}
            onNewComment={openCommentInput}
            onResolveAtCursor={handleResolveAtCursor}
            onDeleteAtCursor={handleDeleteAtCursor}
          />
          {showPreview && <Preview />}
        </main>
        <aside className="hidden w-96 flex-col overflow-hidden lg:flex">
          <div className="shrink-0 border-b border-border">
            <PreviewToggle />
          </div>
          <div className="flex-1 overflow-y-auto">
            <OnboardingBanner />
            <ModeToggle />
            <SuggestionActions />
            {mode === "suggest" && <CleanViewToggle />}
            <div className="border-t border-border" />
            <CommentInput />
            <ThreadList />
          </div>
        </aside>
      </div>
      <MobilePanel className="lg:hidden" />
      <NamePrompt />
    </div>
  );
}
