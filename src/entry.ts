import * as fs from 'fs';
import * as core from '@actions/core';
import OpenAI from 'openai';
import type { GitHub } from '@actions/github/lib/utils';
import type { Context } from '@actions/github/lib/context';
import type { AIConfig } from './index';

interface PRData {
  number: number;
  title: string;
  body: string | null;
  user: { login: string } | null;
  merged_at: string | null;
  labels?: Array<{ name: string }>;
}

interface GenerateEntryOptions {
  pr: PRData;
  octokit: InstanceType<typeof GitHub>;
  context: Context;
  aiConfig: AIConfig;
  changelogPath: string;
}

interface PullRequestDetails {
  title: string;
  body: string;
  author: string;
  reviewers: string[];
  commits: string[];
  filesChanged: string[];
  labels: string[];
  mergedAt: string;
}

export async function generateEntry(options: GenerateEntryOptions): Promise<string> {
  const { pr, octokit, context, aiConfig, changelogPath } = options;

  core.info(`Generating changelog entry for PR #${pr.number}: ${pr.title}`);

  // Fetch additional PR details
  const details = await fetchPRDetails(pr, octokit, context);
  
  // Generate entry using AI
  const entry = await generateWithAI(details, aiConfig);
  
  // Prepend to changelog
  await prependToChangelog(entry, changelogPath);
  
  return entry;
}

async function fetchPRDetails(
  pr: GenerateEntryOptions['pr'],
  octokit: InstanceType<typeof GitHub>,
  context: Context
): Promise<PullRequestDetails> {
  const { owner, repo } = context.repo;

  // Fetch commits
  const { data: commits } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: pr.number,
  });

  // Fetch reviews to get reviewers
  const { data: reviews } = await octokit.rest.pulls.listReviews({
    owner,
    repo,
    pull_number: pr.number,
  });

  // Fetch files changed
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: pr.number,
  });

  const reviewers = [...new Set(
    reviews
      .filter(r => r.state === 'APPROVED')
      .map(r => r.user?.login)
      .filter((login): login is string => !!login)
  )];

  return {
    title: pr.title,
    body: pr.body || '',
    author: pr.user?.login || 'unknown',
    reviewers,
    commits: commits.map(c => c.commit.message),
    filesChanged: files.map(f => f.filename),
    labels: (pr.labels || []).map(l => l.name),
    mergedAt: pr.merged_at || new Date().toISOString(),
  };
}

async function generateWithAI(details: PullRequestDetails, aiConfig: AIConfig): Promise<string> {
  const openai = new OpenAI({ 
    apiKey: aiConfig.apiKey,
    baseURL: aiConfig.baseURL,
  });

  const prompt = buildPrompt(details);

  const response = await openai.chat.completions.create({
    model: aiConfig.model,
    messages: [
      {
        role: 'system',
        content: `You are a technical writer who creates clear, engaging changelog entries.

Your entries should:
- Be written for end users, not developers
- Transform technical details into user benefits
- Be concise but informative
- Use emoji sparingly but effectively (🚀 for features, 🐛 for fixes, ✨ for improvements)
- Highlight what changed and why it matters

HUMANIZER RULES — Avoid AI-sounding patterns:
- No filler phrases: Skip "In order to", "It's important to note", "We're excited to announce"
- No puffery: Cut "pivotal", "seamless", "robust", "cutting-edge", "game-changing"
- No hedging: Say it or don't. Skip "could potentially", "helps to", "allows you to"
- No fake enthusiasm: Skip "We're thrilled", "Excited to share"
- Keep it direct: "Added dark mode" not "We've implemented a new dark mode feature"
- Vary rhythm: Mix short punchy sentences with longer ones
- Be specific: "40% faster" beats "significantly improved performance"

Write like a human updating their friends, not a marketing team.

Output ONLY the changelog entry in markdown format, nothing else.`,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  return formatEntry(content, details);
}

function buildPrompt(details: PullRequestDetails): string {
  const commitSummary = details.commits
    .slice(0, 5) // Limit to avoid token overflow
    .map(c => `- ${c.split('\n')[0]}`) // First line only
    .join('\n');

  const filesSummary = details.filesChanged
    .slice(0, 10)
    .join(', ');

  return `Generate a changelog entry for this merged pull request:

**Title:** ${details.title}

**Description:**
${details.body || 'No description provided.'}

**Commits:**
${commitSummary}

**Files changed:** ${filesSummary}

**Labels:** ${details.labels.join(', ') || 'none'}

Write a user-friendly changelog entry with:
1. A short, descriptive title (with appropriate emoji)
2. 1-2 sentences explaining the change in plain language
3. Optional: 2-3 bullet points if there are multiple aspects

Focus on the user impact, not implementation details.`;
}

function formatEntry(aiContent: string, details: PullRequestDetails): string {
  const date = new Date(details.mergedAt).toISOString().split('T')[0];
  
  const contributors = [details.author, ...details.reviewers]
    .map(u => `@${u}`)
    .join(' • ');

  const attribution = details.reviewers.length > 0
    ? `**Shipped by** ${contributors.split(' • ')[0]} • **Reviewed by** ${details.reviewers.map(r => `@${r}`).join(', ')}`
    : `**Shipped by** @${details.author}`;

  return `## ${date}

${aiContent.trim()}

${attribution}

---

`;
}

async function prependToChangelog(entry: string, changelogPath: string): Promise<void> {
  let existingContent = '';
  
  if (fs.existsSync(changelogPath)) {
    existingContent = fs.readFileSync(changelogPath, 'utf-8');
  }

  // Check if file has a header
  const headerMatch = existingContent.match(/^# .+\n+(?:(?:>.+\n+)|(?:[^#].+\n+))*/);
  
  let newContent: string;
  if (headerMatch) {
    // Insert after header
    const header = headerMatch[0];
    const rest = existingContent.slice(header.length);
    newContent = header + entry + rest;
  } else if (existingContent.trim() === '') {
    // Empty file, add header
    newContent = `# Changelog

All notable changes to this project.

---

${entry}`;
  } else {
    // No header, just prepend
    newContent = entry + existingContent;
  }

  fs.writeFileSync(changelogPath, newContent, 'utf-8');
  core.info(`Updated ${changelogPath}`);
}
