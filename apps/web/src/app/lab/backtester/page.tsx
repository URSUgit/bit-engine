import { redirect } from "next/navigation";

// Backtester is rendered directly inside the main /lab page — link there.
export default function LabBacktesterRedirect() {
  redirect("/lab");
}
