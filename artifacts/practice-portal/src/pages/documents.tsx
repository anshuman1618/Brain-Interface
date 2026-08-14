import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListWorkspaceDocuments,
  useListDocumentRequests,
  useListCases,
  customFetch,
  getListWorkspaceDocumentsQueryKey,
  getListDocumentRequestsQueryKey,
  getListCasesQueryKey,
  type Document as CaseDocument,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { DocumentsSkeleton } from "@/components/module-skeleton";
import { DocumentRequestModal } from "@/components/document-request-modal";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Upload,
  Inbox,
  Send,
  Lock,
  Users,
  AlertCircle,
  Check,
  Clock,
  Plus,
  Download,
} from "lucide-react";

function bytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The document vault — one screen, two directions.
 *
 * Staff see the chamber's files (internal and shared) plus every outstanding
 * request they've raised. A client sees only files shared with them, plus the
 * requests addressed to them, each with an upload that closes the request.
 *
 * Both sides render from the same endpoints; the difference is entirely what the
 * API returns. Nothing here filters for privacy — a client is never sent a
 * firm-internal document in the first place.
 */
export default function DocumentsPage() {
  const { can, activeWorkspace } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isStaff = can("document_requests.create");

  const {
    data: documents = [],
    isLoading: docsLoading,
    isError,
    error,
  } = useListWorkspaceDocuments({
    query: { queryKey: getListWorkspaceDocumentsQueryKey() },
  });
  const { data: requests = [], isLoading: reqLoading } = useListDocumentRequests({
    query: { queryKey: getListDocumentRequestsQueryKey() },
  });
  const { data: cases = [] } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey() },
  });

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [requestOpen, setRequestOpen] = useState(false);
  const [uploadFor, setUploadFor] = useState<{
    requestId?: number;
    caseId?: number;
    label: string;
  } | null>(null);
  const [form, setForm] = useState({ name: "", caseId: "", note: "", visibility: "firm" });

  const pending = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListWorkspaceDocumentsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListDocumentRequestsQueryKey() });
  };

  const openUpload = (opts: { requestId?: number; caseId?: number; label: string }) => {
    setUploadFor(opts);
    setFile(null);
    setForm({
      name: "",
      caseId: opts.caseId ? String(opts.caseId) : cases[0] ? String(cases[0].id) : "",
      note: "",
      visibility: isStaff ? "firm" : "shared",
    });
  };

  /**
   * Sends the file itself.
   *
   * The bytes go as a raw body with the metadata in headers — the API has no
   * multipart parser by design. `customFetch` is used rather than a generated
   * hook because the generated client speaks JSON; this is the one request in
   * the app that is not JSON, and it still needs the same auth and workspace
   * headers every other call carries.
   */
  const submitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const caseId = Number(form.caseId);
    if (!file || !Number.isInteger(caseId)) return;

    setUploading(true);
    try {
      await customFetch(`/api/cases/${caseId}/documents/content`, {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-document-name": encodeURIComponent(form.name.trim() || file.name),
          "x-document-visibility": isStaff ? form.visibility : "shared",
          ...(uploadFor?.requestId ? { "x-document-request-id": String(uploadFor.requestId) } : {}),
        },
        body: file,
      });
      refresh();
      toast({
        title: "Document uploaded",
        description: uploadFor?.requestId ? "The request is now marked fulfilled." : undefined,
      });
      setUploadFor(null);
      setFile(null);
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  /** Fetch the bytes, then hand the browser a blob to save. */
  const download = async (id: number, name: string) => {
    try {
      const blob = await customFetch<Blob>(`/api/documents/${id}/content`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Could not download",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  if (docsLoading || reqLoading) return <DocumentsSkeleton />;

  if (isError) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 p-10 text-center">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
        <p className="font-medium mb-1">Couldn't load documents</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "The request failed."}
        </p>
        <Button variant="outline" className="rounded-lg mt-5" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Documents</h2>
          <p className="text-muted-foreground">
            {isStaff
              ? `Case files for ${activeWorkspace?.name}, and the documents you've asked clients for.`
              : "Files your chamber has shared with you, and anything they've asked you to send."}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {can("documents.write") && cases.length > 0 && (
            <Button
              variant="outline"
              className="rounded-lg"
              onClick={() => openUpload({ label: "Upload a document" })}
            >
              <Upload className="mr-2 h-4 w-4" /> Upload
            </Button>
          )}
          {isStaff && (
            <Button className="rounded-lg" onClick={() => setRequestOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Request a document
            </Button>
          )}
        </div>
      </div>

      {/* ── Requests ─────────────────────────────────────────────────── */}
      <section className="rounded-lg bg-card shadow-sm">
        <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
          {isStaff ? (
            <Send className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Inbox className="h-4 w-4 text-muted-foreground" />
          )}
          <h3 className="font-mono text-xs uppercase tracking-widest font-bold">
            {isStaff ? "Requests you've raised" : "Documents requested from you"}
          </h3>
          {pending.length > 0 && (
            <span className="ml-auto text-xs font-mono uppercase tracking-wider bg-destructive text-destructive-foreground px-2 py-0.5">
              {pending.length} outstanding
            </span>
          )}
        </div>

        {requests.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground font-mono uppercase tracking-wider">
            {isStaff ? "You haven't requested anything yet" : "Nothing has been requested from you"}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {requests.map((r) => {
              const overdue =
                r.dueDate && r.status === "pending" && new Date(r.dueDate) < new Date();
              return (
                <div key={r.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">{r.documentName}</span>
                      <Badge
                        variant="outline"
                        className={`rounded-lg text-3xs uppercase font-mono tracking-wider px-1 py-0 ${
                          r.status === "fulfilled"
                            ? "text-primary border-primary/40"
                            : overdue
                              ? "text-destructive border-destructive/40"
                              : ""
                        }`}
                      >
                        {r.status === "fulfilled" ? "fulfilled" : overdue ? "overdue" : r.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider flex flex-wrap gap-x-2 gap-y-1">
                      <span>
                        {isStaff
                          ? `From: ${r.requestedFromName || r.clientName || "Client"}`
                          : `Asked by ${r.requestedBy}`}
                        {r.requestedByRole && !isStaff ? ` (${r.requestedByRole})` : ""}
                      </span>
                      {r.dueDate && (
                        <>
                          <span>·</span>
                          <span className={overdue ? "text-destructive font-bold" : ""}>
                            Due {new Date(r.dueDate).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </p>
                    {r.note && (
                      <p className="text-sm text-muted-foreground italic mt-1.5">"{r.note}"</p>
                    )}
                  </div>

                  <div className="shrink-0">
                    {r.status === "fulfilled" ? (
                      <span className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-primary">
                        <Check className="h-3.5 w-3.5" /> Received
                      </span>
                    ) : !isStaff ? (
                      <Button
                        className="rounded-lg"
                        onClick={() =>
                          openUpload({
                            requestId: r.id,
                            caseId: r.caseId ?? undefined,
                            label: r.documentName,
                          })
                        }
                      >
                        <Upload className="mr-2 h-4 w-4" /> Upload
                      </Button>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" /> Awaiting upload
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Vault ────────────────────────────────────────────────────── */}
      <section className="rounded-lg bg-card shadow-sm">
        <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-mono text-xs uppercase tracking-widest font-bold">
            {isStaff ? "Case files" : "Files shared with you"}
          </h3>
          <span className="ml-auto text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {documents.length} {documents.length === 1 ? "file" : "files"}
          </span>
        </div>

        {documents.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground font-mono uppercase tracking-wider">
            {isStaff
              ? "No files yet — upload the first"
              : "Your chamber hasn't shared any files yet"}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {documents.map((d: CaseDocument) => (
              <div key={d.id} className="p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
                <div className="h-9 w-9 border border-border flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm truncate">{d.name}</span>
                    {/* Only staff ever see this chip, because a client is only
                        ever sent 'shared' documents in the first place. */}
                    {isStaff && (
                      <Badge
                        variant="outline"
                        className="rounded-lg text-3xs uppercase font-mono tracking-wider px-1 py-0 flex items-center gap-1"
                      >
                        {d.visibility === "shared" ? (
                          <Users className="h-2.5 w-2.5" />
                        ) : (
                          <Lock className="h-2.5 w-2.5" />
                        )}
                        {d.visibility === "shared" ? "Shared with client" : "Firm only"}
                      </Badge>
                    )}
                    {d.documentRequestId && (
                      <Badge
                        variant="outline"
                        className="rounded-lg text-3xs uppercase font-mono tracking-wider px-1 py-0"
                      >
                        Fulfils a request
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider truncate">
                    {d.caseTitle ? `${d.caseTitle} · ` : ""}
                    {d.uploadedBy || "Unknown"}
                    {d.uploadedByRole ? ` (${d.uploadedByRole})` : ""}
                    {` · ${bytes(d.fileSize)}`}
                    {` · ${new Date(d.uploadedAt).toLocaleDateString()}`}
                  </p>
                  {d.note && (
                    <p className="text-sm text-muted-foreground italic mt-1">"{d.note}"</p>
                  )}
                </div>
                {/* Only offered when there are bytes behind the record. */}
                {d.storagePath && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg shrink-0"
                    onClick={() => download(d.id, d.name)}
                    title={`Download ${d.name}`}
                  >
                    <Download className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <DocumentRequestModal open={requestOpen} onOpenChange={setRequestOpen} />

      <Dialog open={uploadFor !== null} onOpenChange={(o) => !o && setUploadFor(null)}>
        <DialogContent className="sm:max-w-[460px] rounded-lg border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              Upload document
            </DialogTitle>
            <DialogDescription className="font-mono text-xs uppercase tracking-wider">
              {uploadFor?.requestId ? `Fulfils: ${uploadFor.label}` : "Add a file to a matter"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitUpload} className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                File name *
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="rounded-lg font-mono text-sm bg-background"
                placeholder="Defaults to the file name"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                File *
              </label>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  // Pre-fill the label from the file unless one was typed.
                  if (f && !form.name.trim()) setForm((prev) => ({ ...prev, name: f.name }));
                }}
                className="rounded-lg font-mono text-xs bg-background file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-mono file:uppercase"
                required
              />
              {file && (
                <p className="text-2xs font-mono text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB · {file.type || "unknown type"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Matter *
              </label>
              <Select value={form.caseId} onValueChange={(v) => setForm({ ...form, caseId: v })}>
                <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                  <SelectValue placeholder="SELECT MATTER" />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  {cases.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isStaff && (
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  Visibility
                </label>
                <Select
                  value={form.visibility}
                  onValueChange={(v) => setForm({ ...form, visibility: v })}
                >
                  <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    <SelectItem value="firm">Firm only — internal working material</SelectItem>
                    <SelectItem value="shared">Shared — the client can see it</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Note
              </label>
              <Textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="rounded-lg font-mono text-sm bg-background resize-none h-20"
                placeholder="Anything the reader should know..."
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg"
                onClick={() => setUploadFor(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-lg font-mono uppercase tracking-wider"
                disabled={uploading || !file || !form.caseId}
              >
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
