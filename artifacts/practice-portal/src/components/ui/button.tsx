import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// A button is the one control that is unambiguously extruded: it stands proud
// of the ground at rest and sinks under the finger. That travel is the whole
// affordance, so the relief lives in the base string, and the two variants that
// are deliberately not surfaces — ghost and link — opt back out of it.
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background shadow-sm active:shadow-[var(--press-sm)] disabled:shadow-none transition-[color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 hover-elevate",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover-elevate",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground hover-elevate",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover-elevate",
        ghost: "shadow-none active:shadow-none hover:bg-accent hover:text-accent-foreground",
        link: "shadow-none active:shadow-none text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
