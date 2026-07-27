export default function NotFound() {
  return (
    <div className="flex h-[80vh] flex-col items-center justify-center bg-background text-foreground p-8 text-center">
      <div className="h-16 w-16 bg-muted border border-border flex items-center justify-center mb-8">
        <span className="font-mono text-2xl font-bold text-muted-foreground">404</span>
      </div>
      <h1 className="text-4xl font-bold tracking-tight mb-4">Case Not Found</h1>
      <p className="text-lg text-muted-foreground mb-8 max-w-md">
        The requested resource is either unavailable or you lack the necessary clearance to view it.
      </p>
      <button 
        onClick={() => window.history.back()}
        className="px-6 py-3 border border-border bg-background hover:bg-accent font-medium transition-colors"
      >
        Return to Previous Context
      </button>
    </div>
  );
}
