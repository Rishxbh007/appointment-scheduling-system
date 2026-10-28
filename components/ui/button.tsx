import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Shared button. API unchanged from before (variant + size props), with
 * one additive variant: "secondary" (soft teal). Visual changes in
 * Task 2: rounded-xl everywhere, teal primary instead of slate-900,
 * and a visible keyboard focus ring on EVERY variant (previously none).
 * Class-name overrides passed by callers still win via tailwind-merge.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-brand-700 text-white hover:bg-brand-800",
        secondary:
          "border border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100",
        outline:
          "border border-border bg-surface hover:bg-page text-ink",
        ghost: "hover:bg-page text-ink",
        destructive: "bg-danger text-white hover:bg-danger-strong",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
