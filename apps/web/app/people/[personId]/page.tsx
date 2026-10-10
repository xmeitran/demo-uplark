import { redirect } from "next/navigation";

export default async function PeopleProfilePage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  redirect(`/users/${encodeURIComponent(personId)}`);
}
