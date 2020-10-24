import * as github from '@actions/github'
import { MergeMethod } from './mergeMethod'

export type Octoapi = ReturnType<typeof createOctoapi>

export const createOctoapi = ({
  token,
  owner,
  repo,
}: {
  token: string
  owner: string
  repo: string
}) => {
  const octokit = github.getOctokit(token)

  const getPullRequest = async (prNumber: number) =>
    await octokit.pulls.get({ owner, repo, pull_number: prNumber })

  const getAllPullRequests = async () =>
    await octokit.pulls.list({ owner, repo })

  const mergePullRequest = async (prNumber: number, mergeMethod: MergeMethod) =>
    await octokit.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: mergeMethod,
    })

  const updatePullRequestWithBaseBranch = async (prNumber: number) =>
    await octokit.pulls.updateBranch({ owner, repo, pull_number: prNumber })

  const addLabel = async (prNumber: number, label: string) =>
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels: [label],
    })

  const removeLabel = async (prNumber: number, label: string) =>
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: prNumber,
      name: label,
    })

  return {
    getPullRequest,
    getAllPullRequests,
    mergePullRequest,
    updatePullRequestWithBaseBranch,
    addLabel,
    removeLabel,
  }
}
