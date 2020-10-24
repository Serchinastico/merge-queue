import * as core from '@actions/core'
import * as github from '@actions/github'
import { Context } from '@actions/github/lib/context'
import * as Webhooks from '@octokit/webhooks'
import c from 'ansi-colors'
import { log } from './log'
import { mapMergeMethod, MergeMethod } from './mergeMethod'
import { createOctoapi, Octoapi } from './octoapi'

interface Input {
  mergeLabelName: string
  mergeErrorLabelName: string
  githubToken: string
  mergeMethod: MergeMethod
  baseBranchName: string
}

const getInput = (): Input => {
  const mergeLabelName = core.getInput('merge-label', { required: true })
  const mergeErrorLabelName = core.getInput('error-label', { required: true })
  const githubToken = core.getInput('github-token', { required: true })
  const mergeMethod = core.getInput('merge-method', { required: true })

  const baseBranchName = core.getInput('base-branch', { required: true })

  return {
    mergeLabelName,
    mergeErrorLabelName,
    githubToken,
    mergeMethod: mapMergeMethod(mergeMethod),
    baseBranchName,
  }
}

const isEventInBaseBranch = (context: Context) => {
  const isFromPullRequest = !!context.payload.pull_request

  return !isFromPullRequest
}

const fireNextPullRequestUpdate = async (input: Input, octoapi: Octoapi) => {
  const allOpenPullRequests = await octoapi.getAllPullRequests()

  const allPullRequestsReadyToBeMerged = allOpenPullRequests.data.filter((pr) =>
    pr.labels.some((label) => label.name === input.mergeLabelName)
  )
  let didMergeAnyPullRequest = false

  while (!didMergeAnyPullRequest && allPullRequestsReadyToBeMerged.length > 0) {
    const nextPullRequestInQueue = allPullRequestsReadyToBeMerged.shift()!

    log(`Updating next PR in line: #${nextPullRequestInQueue.number}.`)

    try {
      await octoapi.updatePullRequestWithBaseBranch(
        nextPullRequestInQueue.number
      )

      didMergeAnyPullRequest = true
    } catch (error) {
      log(`Unable to update PR #${nextPullRequestInQueue.number}.`, 'error')
      // All Pull Requests are issues
      await octoapi.removeLabel(
        nextPullRequestInQueue.number,
        input.mergeLabelName
      )

      await octoapi.addLabel(
        nextPullRequestInQueue.number,
        input.mergeErrorLabelName
      )
    }
  }

  if (!didMergeAnyPullRequest) {
    log('No PR found ready to be merged')
  }
}

const mergePullRequestIfPossible = async (
  context: Context,
  input: Input,
  octoapi: Octoapi
) => {
  const payload = context.payload as Webhooks.EventPayloads.WebhookPayloadPullRequest
  const prNumber = payload.pull_request.number
  const labels = payload.pull_request.labels

  const hasReadyToMergeLabel = labels.some(
    (label) => label.name === input.mergeLabelName
  )
  if (!hasReadyToMergeLabel) {
    log(`PR #${prNumber} does not have the "${input.mergeLabelName}" label.`)
    return
  }

  const pullRequest = await octoapi.getPullRequest(prNumber)

  if (pullRequest.data.state !== 'open') {
    log(`PR #${prNumber} is not open. Cannot merge it.`, 'error')
    return
  }

  if (pullRequest.data.draft) {
    log(`PR #${prNumber} is in draft. Cannot merge it.`, 'error')
    return
  }

  if (!pullRequest.data.mergeable) {
    log(`PR #${prNumber} can't be merged.`, 'error')
    return
  }

  // Pull Request is out of date and we should update it
  if (pullRequest.data.mergeable_state === 'behind') {
    log(`PR #${prNumber} is outdated.`)

    // See if it's next in line
    const allPullRequests = await octoapi.getAllPullRequests()

    const firstPullRequestInQueue = allPullRequests.data.find((pr) =>
      pr.labels.find((label) => label.name === input.mergeLabelName)
    )

    if (firstPullRequestInQueue?.id !== pullRequest.data.id) {
      log(`PR #${prNumber} is not next in line.`)
      return
    }

    log(`Updating PR #${prNumber}.`)
    await octoapi.updatePullRequestWithBaseBranch(payload.pull_request.number)
    return
  }

  log(`Merging PR #${prNumber}.`, 'success')
  await octoapi.mergePullRequest(payload.pull_request.number, input.mergeMethod)
}

const run = async (): Promise<void> => {
  try {
    const context = github.context
    const input = getInput()

    const repository = context.payload.repository
    const repositoryCompanyName = repository?.owner.name
    const repositoryUserName = repository?.owner.login

    const owner = repositoryCompanyName ?? repositoryUserName ?? ''
    const repo = repository?.name ?? ''

    const octoapi = createOctoapi({ token: input.githubToken, owner, repo })

    if (isEventInBaseBranch(context)) {
      log('Running base branch flow')
      await fireNextPullRequestUpdate(input, octoapi)
    } else {
      log('Running Pull Request flow')
      await mergePullRequestIfPossible(context, input, octoapi)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
