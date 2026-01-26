import type { GitHub } from '@actions/github/lib/utils';
import type { Context } from '@actions/github/lib/context';
import type { AIConfig } from './index';
interface PRData {
    number: number;
    title: string;
    body: string | null;
    user: {
        login: string;
    } | null;
    merged_at: string | null;
    labels?: Array<{
        name: string;
    }>;
}
interface GenerateEntryOptions {
    pr: PRData;
    octokit: InstanceType<typeof GitHub>;
    context: Context;
    aiConfig: AIConfig;
    changelogPath: string;
}
export declare function generateEntry(options: GenerateEntryOptions): Promise<string>;
export {};
