import React from "react";

export type ButtonVariant = "secondary" | "primary" | "accent" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Botão quadrado, só com ícone. Exige `aria-label`. */
  iconOnly?: boolean;
}

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", iconOnly = false, className = ""): string {
  return [
    "cb-btn",
    variant !== "secondary" && `cb-btn--${variant}`,
    size !== "md" && `cb-btn--${size}`,
    iconOnly && "cb-btn--icon",
    className,
  ].filter(Boolean).join(" ");
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", iconOnly = false, className, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, iconOnly, className)} {...props} />;
});
