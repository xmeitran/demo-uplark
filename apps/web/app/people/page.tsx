import { redirect } from "next/navigation";

// Hồ sơ nhân sự was merged into Users; keep the old URL working.
export default function PeoplePage() {
  redirect("/users");
}
