export function buildCreateProjectHref(search = "") {
  const params = new URLSearchParams(search);
  params.set("create", "1");
  return `/projects?${params.toString()}`;
}

export function buildProjectsHrefWithoutCreate(search = "") {
  const params = new URLSearchParams(search);
  params.delete("create");
  const query = params.toString();
  return query ? `/projects?${query}` : "/projects";
}
