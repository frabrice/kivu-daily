import { cloneElement, isValidElement, ReactElement, ReactNode, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, Placement, safePolygon, shift, useClick, useDismiss, useFloating,
  useFocus, useHover, useInteractions, useRole,
} from '@floating-ui/react';

// Floating pieces for the whole app: Tooltip (hover/focus), Popover
// (click; menus, pickers) and HoverCard (hover with a grace area so you
// can move into it). Positioned with floating-ui: they flip and shift to
// stay on screen, close on Esc and outside click.

type TriggerEl = ReactElement<Record<string, unknown>>;

export function Tooltip({ label, children, placement = 'top', delay = 350 }: { label: ReactNode; children: TriggerEl; placement?: Placement; delay?: number }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange: setOpen, placement, whileElementsMounted: autoUpdate, middleware: [offset(6), flip(), shift({ padding: 8 })] });
  const { getReferenceProps, getFloatingProps } = useInteractions([useHover(context, { delay: { open: delay, close: 0 } }), useFocus(context), useDismiss(context), useRole(context, { role: 'tooltip' })]);
  if (!isValidElement(children)) return children;
  return (
    <>
      {cloneElement(children, { ref: refs.setReference, ...getReferenceProps(children.props) })}
      {open && label && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[100] px-2 py-1 rounded-md bg-fg text-canvas text-caption font-medium shadow-overlay pointer-events-none max-w-xs">
            {label}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export function Popover({ trigger, children, placement = 'bottom-end', width, open: controlled, onOpenChange }: {
  trigger: TriggerEl; children: ReactNode | ((close: () => void) => ReactNode); placement?: Placement; width?: number; open?: boolean; onOpenChange?: (o: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = onOpenChange ?? setOwn;
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange: setOpen, placement, whileElementsMounted: autoUpdate, middleware: [offset(6), flip(), shift({ padding: 8 })] });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context, { role: 'dialog' })]);
  return (
    <>
      {cloneElement(trigger, { ref: refs.setReference, ...getReferenceProps(trigger.props) })}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
            <div ref={refs.setFloating} style={{ ...floatingStyles, width }} {...getFloatingProps()} className="z-[90] bg-surface-3 border border-line rounded-lg shadow-overlay animate-scale-in overflow-hidden">
              {typeof children === 'function' ? children(() => setOpen(false)) : children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

export function HoverCard({ trigger, children, placement = 'bottom-start', width = 300 }: { trigger: TriggerEl; children: ReactNode; placement?: Placement; width?: number }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange: setOpen, placement, whileElementsMounted: autoUpdate, middleware: [offset(6), flip(), shift({ padding: 8 })] });
  const { getReferenceProps, getFloatingProps } = useInteractions([useHover(context, { delay: { open: 450, close: 120 }, handleClose: safePolygon() }), useDismiss(context)]);
  return (
    <>
      {cloneElement(trigger, { ref: refs.setReference, ...getReferenceProps(trigger.props) })}
      {open && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={{ ...floatingStyles, width }} {...getFloatingProps()} className="z-[95] bg-surface-3 border border-line rounded-lg shadow-overlay animate-scale-in">
            {children}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export function MenuItem({ icon: Icon, label, hint, onClick, danger }: { icon?: LucideIcon; label: ReactNode; hint?: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-body text-left hover:bg-hover ${danger ? 'text-danger' : 'text-fg'}`}>
      {Icon && <Icon size={15} className={danger ? '' : 'text-fg-muted'} />}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-caption text-fg-subtle">{hint}</span>}
    </button>
  );
}

export const MenuDivider = () => <div className="my-1 border-t border-line-muted" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <p className="px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-wide text-fg-subtle">{children}</p>;
