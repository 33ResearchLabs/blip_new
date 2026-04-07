import { redirect } from "next/navigation";

export default function OpsAccessRedirect() {
  redirect("/admin/access-control?tab=ops");
}
