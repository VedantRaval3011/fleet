"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import dynamic from "next/dynamic";
import { ComponentType } from "react";

// The underlying exact props our component accepts
interface ExpenseMapProps {
  expenses: any[];
}

// Ensure TypeScript strictly types the dynamic import
const ExpenseMapCore = dynamic(
  () => import("@/components/ExpenseMapCore"),
  {
    ssr: false,
    loading: () => <div className="h-[600px] w-full bg-slate-900 rounded-xl animate-pulse" />
  }
);

export default function ExpenseMap({ expenses }: ExpenseMapProps) {
  return <ExpenseMapCore expenses={expenses} />;
}
