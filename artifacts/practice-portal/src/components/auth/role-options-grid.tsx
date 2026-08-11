import { Check } from "lucide-react";
import { ROLE_OPTIONS, type RoleValue } from "@/lib/role-options";

export function RoleOptionsGrid({
  selected,
  onSelect,
}: {
  selected: RoleValue | null;
  onSelect: (value: RoleValue) => void;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {ROLE_OPTIONS.map((opt) => {
        const isSelected = selected === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={`text-left rounded-lg p-5 transition-[background-color,box-shadow] relative ${
              isSelected
                ? "bg-accent shadow-[var(--press-sm)]"
                : "bg-card shadow-sm hover:bg-accent/50"
            }`}
          >
            {isSelected && (
              <div className="absolute top-3 right-3 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                <Check className="h-3.5 w-3.5" />
              </div>
            )}
            <opt.icon className="h-6 w-6 mb-3 text-foreground" />
            <div className="font-semibold mb-1">{opt.label}</div>
            <div className="text-sm text-muted-foreground">{opt.description}</div>
          </button>
        );
      })}
    </div>
  );
}
