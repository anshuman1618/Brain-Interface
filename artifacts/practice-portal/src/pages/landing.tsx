import { Link } from "wouter";
import { Briefcase, ArrowRight, ShieldCheck, Scale, Globe } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="min-h-20 border-b border-border flex flex-wrap items-center justify-between gap-y-2 py-3 sm:py-0 px-4 sm:px-8 relative z-10 bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-primary text-primary-foreground flex items-center justify-center font-mono font-bold text-lg tracking-tighter shadow-sm">
            LEX
          </div>
          <span className="font-mono font-bold tracking-tight text-xl">PRACTICE</span>
        </div>
        <div className="flex gap-2 sm:gap-4 items-center">
          <Link
            href="/portal"
            className="text-sm font-semibold hover:text-primary transition-colors px-4 py-2"
          >
            Sign In
          </Link>
          <Link
            href="/portal?new=1"
            className="text-sm font-semibold bg-primary text-primary-foreground px-4 sm:px-6 py-2.5 shadow-sm hover:bg-primary/90 transition-all active:scale-95 border border-primary"
          >
            Set up a chamber
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Abstract geometric background patterns for depth */}
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-secondary/50 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3 pointer-events-none" />

        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] pointer-events-none z-0" />

        <div className="flex-1 flex flex-col justify-center max-w-6xl mx-auto w-full px-8 py-20 relative z-10">
          <div className="max-w-3xl animate-in slide-in-from-bottom-8 fade-in duration-700">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-card shadow-sm mb-8 shadow-sm">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="text-xs font-mono font-semibold tracking-wider uppercase text-muted-foreground">
                Private Legal Extranet
              </span>
            </div>

            <h1 className="text-6xl md:text-8xl font-bold tracking-tighter mb-8 leading-[1.05]">
              Precision.
              <br />
              <span className="text-muted-foreground">Discretion.</span>
              <br />
              Advocacy.
            </h1>

            <p className="text-xl md:text-2xl text-muted-foreground mb-12 max-w-2xl font-light leading-relaxed">
              An invite-only digital environment for complex case management, secure client
              communication, and rigorous task pipelining.
            </p>

            <div className="flex flex-wrap gap-4">
              {/* Single front door. Everyone — staff and clients alike — signs in
                  through the same layer and is sorted by the access list. */}
              <Link
                href="/portal"
                className="inline-flex items-center justify-center gap-2 bg-foreground text-background px-8 py-4 text-lg font-semibold hover:bg-foreground/90 transition-all border border-foreground"
              >
                Chamber Portal
                <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                href="/portal?new=1"
                className="inline-flex items-center justify-center gap-2 bg-background text-foreground px-8 py-4 text-lg font-semibold border border-border hover:bg-accent transition-all shadow-sm"
              >
                Set up a chamber
              </Link>
            </div>
            <p className="mt-6 text-sm text-muted-foreground max-w-xl">
              Sign in with Google, Zoho Mail, or your email address. Firm Admins and Senior
              Advocates set up a chamber directly; everyone else joins by invitation from their
              chamber's admin.
            </p>
          </div>
        </div>

        <div className="border-t border-border bg-card/50 backdrop-blur-sm py-16 relative z-10">
          <div className="max-w-6xl mx-auto px-8 grid md:grid-cols-3 gap-12">
            <div className="flex flex-col gap-4">
              <Scale className="h-8 w-8 text-primary" />
              <h3 className="text-xl font-bold tracking-tight">Structured Pipeline</h3>
              <p className="text-muted-foreground leading-relaxed">
                Task turnaround metrics, SLA adherence tracking, and strict role-based access
                control. Built for the rigorous demands of modern legal advocacy.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <Briefcase className="h-8 w-8 text-primary" />
              <h3 className="text-xl font-bold tracking-tight">Case Vaults</h3>
              <p className="text-muted-foreground leading-relaxed">
                Encrypted document sharing and status tracking. Clients remain informed while firm
                operators maintain narrative control.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <Globe className="h-8 w-8 text-primary" />
              <h3 className="text-xl font-bold tracking-tight">Digital Consultations</h3>
              <p className="text-muted-foreground leading-relaxed">
                Built-in digital consent logging and consultation recording. Never lose a detail
                from a client interaction again.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
