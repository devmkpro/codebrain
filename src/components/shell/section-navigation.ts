import React from "react";

/** Open first, then scroll the actual settings container after React commits. */
export function useSectionNavigation<Id extends string>(
  setOpen: React.Dispatch<React.SetStateAction<Id[]>>,
) {
  const scrollRef = React.useRef<HTMLElement>(null);
  const [requested, setRequested] = React.useState<{ id: Id } | null>(null);
  const selectSection = (id: Id) => {
    setOpen((open) => open.includes(id) ? open : [...open, id]);
    setRequested({ id });
  };

  React.useLayoutEffect(() => {
    if (!requested) return;
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current;
      const section = document.getElementById(`settings-${requested.id}`);
      if (!container || !section || !container.contains(section)) return;
      container.scrollTo({
        top: Math.max(0, container.scrollTop + section.getBoundingClientRect().top - container.getBoundingClientRect().top - 12),
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
      section.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [requested]);

  return { scrollRef, selectSection };
}
