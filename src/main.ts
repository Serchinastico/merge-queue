import * as core from '@actions/core'
import * as github from '@actions/github'
import { Context } from '@actions/github/lib/context'
import { GitHub } from '@actions/github/lib/utils'
import * as Webhooks from '@octokit/webhooks'
import c from 'ansi-colors'

type MergeMethod = 'merge' | 'rebase' | 'squash'
type Octokit = InstanceType<typeof GitHub>
interface Input {
  mergeLabelName: string
  githubToken: string
  mergeMethod: MergeMethod
  baseBranchName: string
}

const mapMergeMethod = (mergeMethod: string): MergeMethod => {
  switch (mergeMethod) {
    case 'merge':
      return 'merge'
    case 'rebase':
      return 'rebase'
    case 'squash':
      return 'squash'
    default:
      core.warning(
        `Unknown merge method provided to the script: "${mergeMethod}", using default "merge" method.`
      )
      return 'merge'
  }
}

const getInput = (): Input => {
  const mergeLabelName = core.getInput('merge-label', { required: true })
  const githubToken = core.getInput('github-token', { required: true })
  const mergeMethod = core.getInput('merge-method', { required: true })
  const baseBranchName = core.getInput('base-branch', { required: true })

  return {
    mergeLabelName,
    githubToken,
    mergeMethod: mapMergeMethod(mergeMethod),
    baseBranchName,
  }
}

const isEventInBaseBranch = (context: Context) => {
  const isFromPullRequest = !!context.payload.pull_request

  return !isFromPullRequest
}

const fireNextPullRequestUpdate = async (
  context: Context,
  input: Input,
  octokit: Octokit
) => {
  const repository = context.payload.repository
  const repositoryCompanyName = repository?.owner.name
  const repositoryUserName = repository?.owner.login

  const owner = repositoryCompanyName ?? repositoryUserName ?? ''
  const repo = repository?.name ?? ''

  const allOpenPullRequests = await octokit.pulls.list({
    owner,
    repo,
    state: 'open',
    base: input.baseBranchName,
    sort: 'created',
    direction: 'asc',
  })

  const allPullRequestsReadyToBeMerged = allOpenPullRequests.data.filter((pr) =>
    pr.labels.some((label) => label.name === input.mergeLabelName)
  )
  let didMergeAnyPullRequest = false

  while (!didMergeAnyPullRequest && allPullRequestsReadyToBeMerged.length > 0) {
    const nextPullRequestInQueue = allPullRequestsReadyToBeMerged.pop()!

    console.log(
      `Updating next Pull Request in line, which is ${c.bold.yellow(
        `#${nextPullRequestInQueue.number}`
      )}.`
    )

    try {
      await octokit.pulls.updateBranch({
        owner,
        repo,
        pull_number: nextPullRequestInQueue.number,
      })
      didMergeAnyPullRequest = true
    } catch (error) {
      // All Pull Requests are issues
      await octokit.issues.removeLabel({
        owner,
        repo,
        issue_number: nextPullRequestInQueue.number,
        name: input.mergeLabelName,
      })
      core.setFailed(
        `Unable to merge Pull Request ${c.bold.yellow(
          `#${nextPullRequestInQueue.number}`
        )}}.`
      )
    }
  }

  if (!didMergeAnyPullRequest) {
    console.log('No Pull Request found ready to be merged')
  }
}

const mergePullRequestIfPossible = async (
  context: Context,
  input: Input,
  octokit: Octokit
) => {
  const payload = context.payload as Webhooks.EventPayloads.WebhookPayloadPullRequest
  const labels = payload.pull_request.labels

  const hasReadyToMergeLabel = labels.some(
    (label) => label.name === input.mergeLabelName
  )
  if (!hasReadyToMergeLabel) {
    console.log(
      `Pull Request does not have the "${c.bold.blue(
        input.mergeLabelName
      )}" label.`
    )
    return
  }

  const pullRequestId = {
    owner: payload.repository.owner.name ?? payload.repository.owner.login,
    repo: payload.repository.name,
    pull_number: payload.pull_request.number,
  }

  const pullRequest = await octokit.pulls.get(pullRequestId)

  if (pullRequest.data.state !== 'open') {
    console.log('Pull Request is not open. Cannot merge it.')
    return
  }

  if (pullRequest.data.draft) {
    console.log('Pull Request is in draft. Cannot merge it.')
    return
  }

  if (!pullRequest.data.mergeable) {
    console.log("Pull Request can't be merged.")
    return
  }

  // Pull Request is out of date and we should update it
  if (pullRequest.data.mergeable_state === 'behind') {
    console.log('Pull Request is outdated.')

    // See if it's next in line
    const allPullRequests = await octokit.pulls.list({
      owner: pullRequestId.owner,
      repo: pullRequestId.repo,
      state: 'open',
      base: input.baseBranchName,
      sort: 'created',
      direction: 'asc',
    })

    const firstPullRequestInQueue = allPullRequests.data.find((pr) =>
      pr.labels.find((label) => label.name === input.mergeLabelName)
    )

    if (firstPullRequestInQueue?.id !== pullRequest.data.id) {
      console.log(
        'Pull Request is not next in line. Waiting for other Pull Request to be merged first.'
      )
      return
    }

    console.log('Updating Pull Request.')
    await octokit.pulls.updateBranch(pullRequestId)
    return
  }

  console.log('Pull Request is about to be merged.')
  await octokit.pulls.merge({
    ...pullRequestId,
    merge_method: input.mergeMethod,
  })
}

const run = async (): Promise<void> => {
  try {
    const context = github.context
    const input = getInput()
    const octokit = github.getOctokit(input.githubToken)

    if (isEventInBaseBranch(context)) {
      console.log('Running base branch flow')
      await fireNextPullRequestUpdate(context, input, octokit)
    } else {
      console.log('Running Pull Request flow')
      await mergePullRequestIfPossible(context, input, octokit)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
