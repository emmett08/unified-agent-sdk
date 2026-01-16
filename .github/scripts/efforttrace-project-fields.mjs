import fs from 'node:fs';

const env = (name, fallback = undefined) => process.env[name] ?? fallback;

const token = env('GH_TOKEN');
if (!token) throw new Error('Missing GH_TOKEN');

const projectOwner = env('EFFORTTRACE_PROJECT_OWNER');
const projectNumber = Number(env('EFFORTTRACE_PROJECT_NUMBER'));
const reportPath = env('EFFORTTRACE_REPORT_PATH');
const repoOwner = env('EFFORTTRACE_REPO_OWNER');
const repoName = env('EFFORTTRACE_REPO_NAME');
const prNumber = Number(env('EFFORTTRACE_PR_NUMBER'));
const updatePrItem = env('EFFORTTRACE_UPDATE_PR_ITEM', 'true') !== 'false';

const fieldNameStart = env('EFFORTTRACE_FIELD_EFFECTIVE_START', 'Effective Start');
const fieldNameEnd = env('EFFORTTRACE_FIELD_EFFECTIVE_END', 'Effective End');
const fieldNameHours = env('EFFORTTRACE_FIELD_EFFECTIVE_HOURS', 'Effective Hours');

if (!projectOwner) throw new Error('Missing EFFORTTRACE_PROJECT_OWNER');
if (!Number.isFinite(projectNumber)) throw new Error('Invalid EFFORTTRACE_PROJECT_NUMBER');
if (!repoOwner) throw new Error('Missing EFFORTTRACE_REPO_OWNER');
if (!repoName) throw new Error('Missing EFFORTTRACE_REPO_NAME');
if (!Number.isFinite(prNumber)) throw new Error('Invalid EFFORTTRACE_PR_NUMBER');

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

const reportExists = reportPath ? fs.existsSync(reportPath) : false;
const report = reportExists ? readJson(reportPath) : {};
if (!reportExists) {
  console.log(`[EffortTrace] No report file found; falling back to PR timestamps.`);
}

const reportEffectiveStartAt = typeof report.effectiveStartAt === 'string' ? report.effectiveStartAt : '';
const reportEffectiveEndAt = typeof report.effectiveEndAt === 'string' ? report.effectiveEndAt : '';
const reportEffectiveHours = Number.isFinite(Number(report.effectiveHoursToEnd)) ? Number(report.effectiveHoursToEnd) : NaN;

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'efforttrace-project-fields'
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (!res.ok || json.errors?.length) {
    const msg = json.errors?.map((e) => e.message).join('; ') || res.statusText;
    throw new Error(`GraphQL error: ${msg}`);
  }
  return json.data;
}

async function getProjectAndFields() {
  const data = await graphql(
    `
    query($login: String!, $number: Int!) {
      user(login: $login) {
        projectV2(number: $number) {
          id
          fields(first: 100) {
            nodes {
              ... on ProjectV2Field {
                id
                name
                dataType
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
              }
            }
          }
        }
      }
    }
  `,
    { login: projectOwner, number: projectNumber }
  );

  const project = data?.user?.projectV2;
  if (!project?.id) throw new Error(`Project not found: ${projectOwner}#${projectNumber}`);

  const fields = project.fields?.nodes ?? [];
  const byName = new Map(fields.map((f) => [f?.name, f]));

  const startField = byName.get(fieldNameStart);
  const endField = byName.get(fieldNameEnd);
  const hoursField = byName.get(fieldNameHours);

  if (!startField?.id) throw new Error(`Missing Project field: ${fieldNameStart}`);
  if (!endField?.id) throw new Error(`Missing Project field: ${fieldNameEnd}`);
  if (!hoursField?.id) throw new Error(`Missing Project field: ${fieldNameHours}`);

  return {
    projectId: project.id,
    startFieldId: startField.id,
    endFieldId: endField.id,
    hoursFieldId: hoursField.id
  };
}

async function getPrContext() {
  const data = await graphql(
    `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          id
          createdAt
          mergedAt
          closingIssuesReferences(first: 20) {
            nodes {
              id
              number
              title
              url
            }
          }
        }
      }
    }
  `,
    { owner: repoOwner, repo: repoName, pr: prNumber }
  );

  const pr = data?.repository?.pullRequest;
  if (!pr?.id) throw new Error(`PR not found: ${repoOwner}/${repoName}#${prNumber}`);
  return {
    pr: { id: pr.id, createdAt: pr.createdAt, mergedAt: pr.mergedAt },
    issues: pr.closingIssuesReferences?.nodes ?? []
  };
}

async function addProjectItem(projectId, contentId) {
  const data = await graphql(
    `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `,
    { projectId, contentId }
  );
  return data?.addProjectV2ItemById?.item?.id;
}

async function findProjectItemIdByContentId(projectId, contentId) {
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const data = await graphql(
      `
      query($projectId: ID!, $after: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                content {
                  ... on Issue { id }
                  ... on PullRequest { id }
                }
              }
            }
          }
        }
      }
    `,
      { projectId, after: cursor }
    );

    const items = data?.node?.items?.nodes ?? [];
    const match = items.find((it) => it?.content?.id === contentId);
    if (match?.id) return match.id;

    const pi = data?.node?.items?.pageInfo;
    if (!pi?.hasNextPage) break;
    cursor = pi.endCursor;
  }
  return null;
}

async function updateTextField(projectId, itemId, fieldId, text) {
  await graphql(
    `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { text: $text }
      }) {
        projectV2Item { id }
      }
    }
  `,
    { projectId, itemId, fieldId, text }
  );
}

async function updateNumberField(projectId, itemId, fieldId, number) {
  await graphql(
    `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { number: $number }
      }) {
        projectV2Item { id }
      }
    }
  `,
    { projectId, itemId, fieldId, number }
  );
}

function computeFallbackHours(startIso, endIso) {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return NaN;
  return Number(((endMs - startMs) / 3_600_000).toFixed(2));
}

const { projectId, startFieldId, endFieldId, hoursFieldId } = await getProjectAndFields();
const ctx = await getPrContext();
const issues = ctx.issues;

const fallbackStartAt = typeof ctx.pr.createdAt === 'string' ? ctx.pr.createdAt : '';
const fallbackEndAt = typeof ctx.pr.mergedAt === 'string' ? ctx.pr.mergedAt : '';

const effectiveStartAt = reportEffectiveStartAt || fallbackStartAt;
const effectiveEndAt = reportEffectiveEndAt || fallbackEndAt;
const effectiveHours =
  Number.isFinite(reportEffectiveHours) ? reportEffectiveHours : computeFallbackHours(effectiveStartAt, effectiveEndAt);

if (!effectiveStartAt || !effectiveEndAt || !Number.isFinite(effectiveHours)) {
  console.log('[EffortTrace] Missing timestamps to compute effective fields; nothing to update.');
  process.exit(0);
}

if (!issues.length) {
  console.log(`[EffortTrace] PR #${prNumber} closes no issues; nothing to update.`);
  if (!updatePrItem) process.exit(0);
}

async function upsertAndUpdateProjectItem(contentId, label) {
  let itemId = null;
  try {
    itemId = await addProjectItem(projectId, contentId);
  } catch (err) {
    itemId = await findProjectItemIdByContentId(projectId, contentId);
  }
  if (!itemId) {
    console.log(`[EffortTrace] Could not find/add project item for ${label}; skipping.`);
    return;
  }

  await updateTextField(projectId, itemId, startFieldId, effectiveStartAt);
  await updateTextField(projectId, itemId, endFieldId, effectiveEndAt);
  await updateNumberField(projectId, itemId, hoursFieldId, effectiveHours);
  console.log(`[EffortTrace] Updated ${label} (project item ${itemId})`);
}

console.log(`[EffortTrace] Writing fields: start=${effectiveStartAt} end=${effectiveEndAt} hours=${effectiveHours}`);

for (const issue of issues) {
  await upsertAndUpdateProjectItem(issue.id, `issue #${issue.number} (${issue.url})`);
}

if (updatePrItem) {
  await upsertAndUpdateProjectItem(ctx.pr.id, `PR #${prNumber}`);
}
