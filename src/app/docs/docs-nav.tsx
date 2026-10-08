"use client";

import { useEffect, useMemo, useState } from "react";
import { LeftToRightListBulletIcon } from "@hugeicons/core-free-icons";
import { Button, cx, Drawer, NavGroup, NavItem } from "@/components/ui";

export type DocsNavSection = { label: string; items: { id: string; name: string; method?: string }[] };

/** The section being read: the last one whose top has passed under the header. */
function useActive(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ids[0];
      for (const id of ids) {
        const node = document.getElementById(id);
        if (node && node.getBoundingClientRect().top <= 120) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("hashchange", update);
    };
  }, [ids]);
  return active;
}

function Label({ name, method }: { name: string; method?: string }) {
  if (!method) return <>{name}</>;
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="w-11 shrink-0 font-mono text-[10.5px] font-semibold tracking-wide text-muted">{method}</span>
      <span className="min-w-0 font-mono text-[12.5px] break-all">{name}</span>
    </span>
  );
}

/** Every route down the left on wide screens. */
export function DocsSidebar({ nav }: { nav: DocsNavSection[] }) {
  const ids = useMemo(() => nav.flatMap((section) => section.items.map((item) => item.id)), [nav]);
  const active = useActive(ids);
  return (
    <nav
      aria-label="Routes"
      className="flex max-h-[calc(100svh-7rem)] flex-col gap-6 overflow-y-auto pb-10 [scrollbar-width:thin]"
    >
      {nav.map((section) => (
        <NavGroup key={section.label} label={section.label}>
          {section.items.map((item) => (
            <NavItem key={item.id} glide="docs-nav" href={`#${item.id}`} active={item.id === active}>
              <Label name={item.name} method={item.method} />
            </NavItem>
          ))}
        </NavGroup>
      ))}
    </nav>
  );
}

/** Below wide screens, the routes open from a small pill at the bottom right. */
export function DocsMobileNav({ nav }: { nav: DocsNavSection[] }) {
  const [open, setOpen] = useState(false);
  const go = (id: string) => {
    setOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };
  return (
    <div className="fixed right-4 bottom-4 z-30 lg:hidden">
      <Button variant="secondary" size="sm" icon={LeftToRightListBulletIcon} className="shadow-float" onClick={() => setOpen(true)}>
        Routes
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Routes">
        <div className="-mx-2 -mt-2 flex flex-col gap-5">
          {nav.map((section) => (
            <div key={section.label}>
              <p className="px-3 pb-1 text-caption font-medium text-muted">{section.label}</p>
              <ul className="flex flex-col">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => go(item.id)}
                      className={cx(
                        "w-full cursor-pointer rounded-item px-3 py-2.5 text-left text-[15px] transition-colors duration-150 hover:bg-control",
                      )}
                    >
                      <Label name={item.name} method={item.method} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
