import { redirect } from "next/navigation";

/** Older route. Expenses now live on a single page. */
export default function IncomeExpenseRedirect() {
  redirect("/expenses");
}
