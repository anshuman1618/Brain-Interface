import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Search, Loader2 } from "lucide-react";
import { useGlobalSearch, getGlobalSearchQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const { data, isFetching } = useGlobalSearch(
    { q: debouncedQuery },
    {
      query: {
        enabled: debouncedQuery.length >= 2,
        queryKey: getGlobalSearchQueryKey({ q: debouncedQuery }),
      },
    },
  );

  const handleNavigate = (path: string) => {
    setLocation(path);
    setOpen(false);
    setQuery("");
  };

  const hasResults =
    data &&
    ((data.cases && data.cases.length > 0) ||
      (data.tasks && data.tasks.length > 0) ||
      (data.consultations && data.consultations.length > 0) ||
      (data.clients && data.clients.length > 0));

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 sm:flex-none sm:w-56 md:w-80">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="SEARCH CASES, TASKS, CLIENTS..."
          className="pl-9 rounded-lg font-mono text-xs uppercase bg-background border-border focus-visible:ring-1 focus-visible:ring-foreground"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (query.length > 0) setOpen(true);
          }}
        />
        {isFetching && (
          <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border shadow-lg z-50 max-h-96 overflow-y-auto">
          {isFetching && !data ? (
            <div className="p-4 space-y-4">
              <div className="h-4 w-1/3 bg-muted animate-pulse" />
              <div className="h-4 w-full bg-muted/50 animate-pulse" />
              <div className="h-4 w-2/3 bg-muted/50 animate-pulse" />
            </div>
          ) : !hasResults && !isFetching ? (
            <div className="p-4 text-center text-xs font-mono uppercase text-muted-foreground">
              No results found for "{query}"
            </div>
          ) : (
            <div className="py-2">
              {data?.cases && data.cases.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-mono font-bold tracking-widest text-muted-foreground uppercase bg-muted/30">
                    Cases
                  </div>
                  {data.cases.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleNavigate(`/cases/${c.id}`)}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm transition-colors"
                    >
                      <div className="font-semibold truncate">{c.title}</div>
                      {c.subtitle && (
                        <div className="text-xs text-muted-foreground truncate">{c.subtitle}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {data?.tasks && data.tasks.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-mono font-bold tracking-widest text-muted-foreground uppercase bg-muted/30">
                    Tasks
                  </div>
                  {data.tasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleNavigate(`/tasks`)}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm transition-colors"
                    >
                      <div className="font-semibold truncate">{t.title}</div>
                      {t.subtitle && (
                        <div className="text-xs text-muted-foreground truncate">{t.subtitle}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {data?.consultations && data.consultations.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-mono font-bold tracking-widest text-muted-foreground uppercase bg-muted/30">
                    Consultations
                  </div>
                  {data.consultations.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleNavigate(`/consultations`)}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm transition-colors"
                    >
                      <div className="font-semibold truncate">{c.title}</div>
                      {c.subtitle && (
                        <div className="text-xs text-muted-foreground truncate">{c.subtitle}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {data?.clients && data.clients.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-mono font-bold tracking-widest text-muted-foreground uppercase bg-muted/30">
                    Clients
                  </div>
                  {data.clients.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleNavigate(`/invites`)}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm transition-colors"
                    >
                      <div className="font-semibold truncate">{c.title}</div>
                      {c.subtitle && (
                        <div className="text-xs text-muted-foreground truncate">{c.subtitle}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
