// OpenCTI GraphQL, read-only. Proxied through vite.config.ts so
// OPENCTI_API_TOKEN never reaches the browser bundle.
export type OpenCtiOwner = { id: string; entity_type: string; name: string };

type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] };

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/opencti/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`OpenCTI GraphQL failed: ${res.status}`);
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data as T;
}

const OWNER_QUERY = `
  query($id: String!) {
    stixCyberObservable(id: $id) {
      id
      observable_value
      stixCoreRelationships(relationship_type: "consists-of") {
        edges {
          node {
            from {
              ... on StixDomainObject {
                id
                entity_type
                representative { main }
              }
            }
          }
        }
      }
    }
  }
`;

type OwnerQueryResult = {
  stixCyberObservable: {
    id: string;
    observable_value: string;
    stixCoreRelationships: {
      edges: { node: { from: { id: string; entity_type: string; representative: { main: string } } | null } }[];
    };
  } | null;
};

export async function fetchOwner(openctiId: string): Promise<OpenCtiOwner | null> {
  const data = await graphql<OwnerQueryResult>(OWNER_QUERY, { id: openctiId });
  const edge = data.stixCyberObservable?.stixCoreRelationships.edges.find((e) => e.node.from);
  const from = edge?.node.from;
  if (!from) return null;
  return { id: from.id, entity_type: from.entity_type, name: from.representative.main };
}
