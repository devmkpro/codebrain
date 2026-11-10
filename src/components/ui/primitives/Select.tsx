import React from "react";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={`cb-select ${className ?? ""}`} {...props} />;
});
