import { createContext, useContext, useState, ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PricingModalContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PricingModalContext = createContext<PricingModalContextType | undefined>(undefined);

export function usePricingModal() {
  const context = useContext(PricingModalContext);
  if (!context) {
    throw new Error("usePricingModal must be used within a PricingModalProvider");
  }
  return context;
}

export function PricingModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <PricingModalContext.Provider value={{ open, setOpen }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl rounded-none border-border bg-background p-0">
          <DialogHeader className="p-8 pb-4 border-b border-border bg-muted/30">
            <DialogTitle className="text-2xl font-mono uppercase tracking-widest text-foreground">
              Select a Subscription
            </DialogTitle>
            <DialogDescription className="font-mono text-muted-foreground uppercase text-xs mt-2">
              Upgrade to unlock unlimited cases, users, and advanced capabilities.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border bg-background">
            {/* Starter */}
            <div className="p-8 flex flex-col hover:bg-muted/10 transition-colors">
              <h3 className="font-mono uppercase tracking-wider font-bold text-foreground mb-2">Starter</h3>
              <div className="text-3xl font-mono mb-4 text-foreground">₹999<span className="text-sm text-muted-foreground">/mo</span></div>
              <ul className="text-sm font-mono text-muted-foreground space-y-3 mb-8 flex-1">
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-foreground">5 Active Cases</li>
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-foreground">2 Users</li>
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-foreground">Basic Support</li>
              </ul>
              <Button variant="outline" className="w-full rounded-none font-mono uppercase tracking-wider">
                Select Plan
              </Button>
            </div>

            {/* Pro */}
            <div className="p-8 flex flex-col bg-slate-800 text-white relative">
              <div className="absolute top-0 right-0 bg-gradient-to-r from-gray-300 to-gray-500 text-black text-[10px] font-bold font-mono uppercase tracking-widest px-3 py-1">
                Current Trial
              </div>
              <h3 className="font-mono uppercase tracking-wider font-bold text-gray-200 mb-2">Pro</h3>
              <div className="text-3xl font-mono mb-4 text-white">₹2,499<span className="text-sm text-gray-400">/mo</span></div>
              <ul className="text-sm font-mono text-gray-300 space-y-3 mb-8 flex-1">
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-white">Unlimited Cases</li>
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-white">10 Users</li>
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-white">Calendar Sync</li>
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-white">Priority Support</li>
              </ul>
              <Button className="w-full rounded-none bg-gradient-to-r from-gray-300 to-gray-500 text-black font-bold font-mono uppercase tracking-wider hover:opacity-90 transition-opacity">
                Upgrade Now
              </Button>
            </div>

            {/* Firm */}
            <div className="p-8 flex flex-col hover:bg-muted/10 transition-colors">
              <h3 className="font-mono uppercase tracking-wider font-bold text-foreground mb-2">Firm</h3>
              <div className="text-3xl font-mono mb-4 text-foreground">₹5,999<span className="text-sm text-muted-foreground">/mo</span></div>
              <ul className="text-sm font-mono text-muted-foreground space-y-3 mb-8 flex-1">
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-foreground">Unlimited Cases</li>
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-foreground">Unlimited Users</li>
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-foreground">Advanced Analytics</li>
                <li className="flex items-center gap-2 before:content-[''] before:w-1.5 before:h-1.5 before:bg-foreground">Dedicated Support</li>
              </ul>
              <Button variant="outline" className="w-full rounded-none font-mono uppercase tracking-wider">
                Select Plan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PricingModalContext.Provider>
  );
}
