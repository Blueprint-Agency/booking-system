"use client";

import { useFormContext } from "react-hook-form";
import type { ReactNode } from "react";
import { Label } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  name: string;
  label?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}

export function FormField({ name, label, hint, children, className, required }: FormFieldProps) {
  const { formState } = useFormContext();
  const err = formState.errors[name];
  const message =
    err && typeof err.message === "string" ? err.message : err ? "Invalid value" : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label htmlFor={name}>
          {label}
          {required && <span className="text-error ml-0.5">*</span>}
        </Label>
      )}
      {children}
      {message ? (
        <p className="text-xs text-error">{message}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
