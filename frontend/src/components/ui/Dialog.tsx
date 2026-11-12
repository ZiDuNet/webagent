import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import "./Dialog.css";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  busy?: boolean;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  busy = false,
}: DialogProps) {
  const descriptionId = useId();
  const previousFocusRef = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="wa-dialog-overlay" />
        <DialogPrimitive.Content
          className={`wa-dialog ${className}`.trim()}
          aria-describedby={description ? descriptionId : undefined}
          onInteractOutside={(event) => busy && event.preventDefault()}
          onEscapeKeyDown={(event) => busy && event.preventDefault()}
          onOpenAutoFocus={() => { previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
          onCloseAutoFocus={(event) => {
            const previous = previousFocusRef.current;
            if (previous?.isConnected) { event.preventDefault(); previous.focus(); }
          }}
        >
          <header className="wa-dialog__header">
            <div>
              <DialogPrimitive.Title className="wa-dialog__title">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description id={descriptionId} className="wa-dialog__description">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="wa-icon-button" disabled={busy} aria-label="关闭弹窗">
              <Icon name="x" size={18} />
            </DialogPrimitive.Close>
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
