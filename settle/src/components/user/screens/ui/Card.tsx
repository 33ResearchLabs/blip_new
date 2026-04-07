import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children?: ReactNode;
  className?: string;
}

/**
 * Card — translucent glass surface used across all user screens.
 * Theme-driven via `bg-surface-card` + `border-border-subtle` tokens,
 * so future light-mode support requires no changes to consumers.
 *
 * Use the `as` prop to render as `button`, `a`, etc.
 *   <Card as="button" onClick={...} className="rounded-2xl p-4">…</Card>
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { as: Tag = "div", className = "", children, ...rest },
  ref
) {
  return (
    <Tag
      ref={ref}
      className={`bg-surface-card border border-border-subtle ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
});
