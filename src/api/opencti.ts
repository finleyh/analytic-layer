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

// ---------- Labels by observable value ----------
//
// "Is this IP an observable in the TIP at all, and what is it labelled?" for IPs that are
// not on netflow-rollups' watchlist (a watched IP's labels are already mirrored in
// `/watch/ips` tags). One query per 100 values rather than one per IP.

const LABELS_QUERY = `
  query($filters: FilterGroup) {
    stixCyberObservables(first: 500, filters: $filters) {
      edges {
        node {
          id
          observable_value
          objectLabel { value }
        }
      }
    }
  }
`;

type LabelsQueryResult = {
  stixCyberObservables: {
    edges: { node: { id: string; observable_value: string; objectLabel: { value: string }[] | null } }[];
  };
};

export type OpenCtiLabels = { id: string; labels: string[] };

/** Observable value → its OpenCTI id and labels, for the values that are observables. */
export async function fetchLabelsByValue(values: string[]): Promise<Map<string, OpenCtiLabels>> {
  const out = new Map<string, OpenCtiLabels>();
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    const data = await graphql<LabelsQueryResult>(LABELS_QUERY, {
      filters: {
        mode: "and",
        filters: [{ key: "value", values: chunk, operator: "eq", mode: "or" }],
        filterGroups: [],
      },
    });
    for (const edge of data.stixCyberObservables.edges) {
      const n = edge.node;
      out.set(n.observable_value, { id: n.id, labels: (n.objectLabel ?? []).map((l) => l.value).sort() });
    }
  }
  return out;
}
