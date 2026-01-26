import * as core from '@actions/core';
import * as github from '@actions/github';
import { generateEntry } from './entry';
import { generateWeeklyDigest } from './weekly';

export interface AIConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

function getAIConfig(): AIConfig {
  const apiKey = core.getInput('api-key', { required: true });
  const provider = core.getInput('provider') || 'openai';
  const model = core.getInput('model') || 'gpt-4o-mini';

  let baseURL: string;
  
  if (provider === 'openai') {
    baseURL = 'https://api.openai.com/v1';
  } else if (provider === 'openrouter') {
    baseURL = 'https://openrouter.ai/api/v1';
  } else if (provider.startsWith('http')) {
    // Custom base URL
    baseURL = provider;
  } else {
    throw new Error(`Unknown provider: ${provider}. Use 'openai', 'openrouter', or a custom URL.`);
  }

  return { apiKey, baseURL, model };
}

async function run(): Promise<void> {
  try {
    const mode = core.getInput('mode', { required: true });
    const aiConfig = getAIConfig();
    const changelogPath = core.getInput('changelog-path') || 'CHANGELOG.md';
    const weeklyPath = core.getInput('weekly-path') || 'WEEKLY.md';
    const includeLabels = core.getInput('include-labels')
      .split(',')
      .map(l => l.trim())
      .filter(Boolean);
    const excludeLabels = core.getInput('exclude-labels')
      .split(',')
      .map(l => l.trim())
      .filter(Boolean);

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    const octokit = github.getOctokit(token);
    const context = github.context;

    if (mode === 'entry') {
      // Per-PR changelog entry
      if (!context.payload.pull_request) {
        core.warning('No pull request found in context. Skipping.');
        core.setOutput('updated', 'false');
        return;
      }

      const prPayload = context.payload.pull_request;
      
      // Check if PR was merged
      if (!prPayload.merged) {
        core.info('PR was not merged. Skipping.');
        core.setOutput('updated', 'false');
        return;
      }

      // Check labels
      const prLabels = (prPayload.labels || []).map((l: { name: string }) => l.name);
      
      if (excludeLabels.some(label => prLabels.includes(label))) {
        core.info(`PR has excluded label. Skipping.`);
        core.setOutput('updated', 'false');
        return;
      }

      if (includeLabels.length > 0 && !includeLabels.some(label => prLabels.includes(label))) {
        core.info(`PR does not have required label. Skipping.`);
        core.setOutput('updated', 'false');
        return;
      }

      // Extract PR data with proper typing
      const pr = {
        number: prPayload.number as number,
        title: prPayload.title as string,
        body: (prPayload.body as string | null) || null,
        user: prPayload.user ? { login: prPayload.user.login as string } : null,
        merged_at: (prPayload.merged_at as string | null) || null,
        labels: prPayload.labels as Array<{ name: string }> | undefined,
      };

      const entry = await generateEntry({
        pr,
        octokit,
        context,
        aiConfig,
        changelogPath,
      });

      core.setOutput('entry', entry);
      core.setOutput('updated', 'true');
      core.info('✅ Changelog entry generated successfully');

    } else if (mode === 'weekly') {
      // Weekly digest
      await generateWeeklyDigest({
        octokit,
        context,
        aiConfig,
        changelogPath,
        weeklyPath,
      });

      core.setOutput('updated', 'true');
      core.info('✅ Weekly digest generated successfully');

    } else {
      throw new Error(`Unknown mode: ${mode}. Use 'entry' or 'weekly'.`);
    }

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
