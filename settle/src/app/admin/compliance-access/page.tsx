import { redirect } from "next/navigation";

export default function ComplianceAccessRedirect() {
  redirect("/admin/access-control?tab=compliance");
}
