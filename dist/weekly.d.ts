import type { GitHub } from '@actions/github/lib/utils';
import type { Context } from '@actions/github/lib/context';
import type { AIConfig } from './index';
interface GenerateWeeklyOptions {
    octokit: InstanceType<typeof GitHub>;
    context: Context;
    aiConfig: AIConfig;
    changelogPath: string;
    weeklyPath: string;
}
export declare function generateWeeklyDigest(options: GenerateWeeklyOptions): Promise<string>;
export {};
