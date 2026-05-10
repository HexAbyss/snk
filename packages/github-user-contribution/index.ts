import { fetchGithubUserContributionHtml } from "./fetchContributionHtml";

/**
 * get the contribution grid from a github user page
 *
 * use options.from=YYYY-MM-DD options.to=YYYY-MM-DD to get the contribution grid for a specific time range
 * or year=2019 as an alias for from=2019-01-01 to=2019-12-31
 *
 * otherwise return use the time range from today minus one year to today ( as seen in github profile page )
 *
 * @param userName github user name
 * @param options
 *
 * @example
 *  getGithubUserContribution("platane", { from: "2019-01-01", to: "2019-12-31" })
 *  getGithubUserContribution("platane", { year: 2019 })
 *
 */
export const getGithubUserContribution = async (
  userName: string,
  o: { githubToken?: string; baseUrl?: string; contributionScope?: "all" | "public" | "private" },
) => {
  const contributionScope = normalizeContributionScope(o.contributionScope);

  if (contributionScope === "public") {
    return getPublicGithubUserContribution(userName);
  }

  if (!o.githubToken) {
    throw new Error(`Missing github token for contribution scope \"${contributionScope}\"`);
  }

  const allContributions = await getAuthenticatedGithubUserContribution(userName, o.githubToken, o.baseUrl);
  if (contributionScope === "all") {
    return allContributions;
  }

  const publicContributions = await getPublicGithubUserContribution(userName);
  return buildPrivateOnlyContribution(allContributions, publicContributions);
};

const getAuthenticatedGithubUserContribution = async (
  userName: string,
  githubToken: string,
  baseUrl?: string,
) => {
  const query = /* GraphQL */ `
    query ($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                contributionLevel
                weekday
                date
              }
            }
          }
        }
      }
    }
  `;
  const variables = { login: userName };

  const apiUrl = baseUrl
    ? `${baseUrl}/api/graphql`
    : "https://api.github.com/graphql";

  const res = await fetch(apiUrl, {
    headers: {
      Authorization: `bearer ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "me@platane.me",
    },
    method: "POST",
    body: JSON.stringify({ variables, query }),
  });

  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));

  const { data, errors } = (await res.json()) as {
    data: GraphQLRes;
    errors?: { message: string }[];
  };

  if (errors?.[0]) throw errors[0];

  return data.user.contributionsCollection.contributionCalendar.weeks.flatMap(
    ({ contributionDays }, x) =>
      contributionDays.map((d) => ({
        x,
        y: d.weekday,
        date: d.date,
        count: d.contributionCount,
        level:
          (d.contributionLevel === "FOURTH_QUARTILE" && 4) ||
          (d.contributionLevel === "THIRD_QUARTILE" && 3) ||
          (d.contributionLevel === "SECOND_QUARTILE" && 2) ||
          (d.contributionLevel === "FIRST_QUARTILE" && 1) ||
          0,
      })),
  );
};

const getPublicGithubUserContribution = async (userName: string) => {
  const cells = await fetchGithubUserContributionHtml(userName);
  return cells.map((cell) => ({ ...cell, count: 0 }));
};

const buildPrivateOnlyContribution = (
  allContributions: Awaited<ReturnType<typeof getAuthenticatedGithubUserContribution>>,
  publicContributions: Awaited<ReturnType<typeof getPublicGithubUserContribution>>,
) => {
  const publicByDate = new Map(publicContributions.map((cell) => [cell.date, cell]));

  // GitHub does not expose a per-day private-only calendar directly.
  // We can only keep days that exist in the authenticated calendar but are absent from the public one.
  return allContributions.map((cell) => {
    const publicCell = publicByDate.get(cell.date);
    if (!publicCell || publicCell.level === 0) {
      return cell;
    }

    return { ...cell, count: 0, level: 0 as 0 };
  });
};

const normalizeContributionScope = (value?: string) => {
  if (value === "public" || value === "private" || value === "all") {
    return value;
  }

  return "all";
};

type GraphQLRes = {
  user: {
    contributionsCollection: {
      contributionCalendar: {
        weeks: {
          contributionDays: {
            contributionCount: number;
            contributionLevel:
              | "FOURTH_QUARTILE"
              | "THIRD_QUARTILE"
              | "SECOND_QUARTILE"
              | "FIRST_QUARTILE"
              | "NONE";
            date: string;
            weekday: number;
          }[];
        }[];
      };
    };
  };
};

export type Res = Awaited<ReturnType<typeof getGithubUserContribution>>;

export type Cell = Res[number];
