import * as core from '@actions/core'
import * as github from '@actions/github'
import { Context } from '@actions/github/lib/context'
import * as Webhooks from '@octokit/webhooks'
import { log } from './log'
import { mapMergeMethod, MergeMethod } from './mergeMethod'
import { createOctoapi, Octoapi } from './octoapi'
import { delay } from './delay'

interface Input {
  githubToken: string
  mergeMethod: MergeMethod
  graceTime: number
  mergeLabelName: string
  blockMergeLabelName: string
  mergeErrorLabelName: string
  baseBranchName: string
}

const getInput = (): Input => {
  const githubToken = core.getInput('github-token', { required: true })
  const mergeMethod = core.getInput('merge-method', { required: true })
  const graceTime = core.getInput('grace-time', { required: true })
  const mergeLabelName = core.getInput('merge-label', { required: true })
  const blockMergeLabelName = core.getInput('block-label', { required: true })
  const mergeErrorLabelName = core.getInput('error-label', { required: true })
  const baseBranchName = core.getInput('base-branch', { required: true })

  return {
    githubToken,
    mergeMethod: mapMergeMethod(mergeMethod),
    graceTime: Number.parseInt(graceTime) ?? 0,
    mergeLabelName,
    blockMergeLabelName,
    mergeErrorLabelName,
    baseBranchName,
  }
}

const isEventInBaseBranch = (context: Context) => {
  const isFromPullRequest = !!context.payload.pull_request

  return !isFromPullRequest
}

const isPullRequestMergeable = (
  pullRequest: { labels: { name: string }[] },
  input: Input
) =>
  pullRequest.labels.some((label) => label.name === input.mergeLabelName) &&
  pullRequest.labels.every(
    (label) =>
      label.name !== input.mergeErrorLabelName &&
      label.name !== input.blockMergeLabelName
  )

const fireNextPullRequestUpdate = async (input: Input, octoapi: Octoapi) => {
  const allOpenPullRequests = await octoapi.getAllPullRequests()

  const allPullRequestsReadyToBeMerged = allOpenPullRequests.data.filter((pr) =>
    isPullRequestMergeable(pr, input)
  )
  let didMergeAnyPullRequest = false

  while (!didMergeAnyPullRequest && allPullRequestsReadyToBeMerged.length > 0) {
    const nextPullRequestInQueue = allPullRequestsReadyToBeMerged.pop()!

    log(`Updating next PR in line: #${nextPullRequestInQueue.number}.`)

    try {
      await octoapi.updatePullRequestWithBaseBranch(
        nextPullRequestInQueue.number
      )

      didMergeAnyPullRequest = true
    } catch (error) {
      log(`Unable to update PR #${nextPullRequestInQueue.number}.`, 'error')
      await octoapi.removeLabel(
        nextPullRequestInQueue.number,
        input.mergeLabelName
      )

      await octoapi.addLabel(
        nextPullRequestInQueue.number,
        input.mergeErrorLabelName
      )

      await octoapi.postComment(
        nextPullRequestInQueue.number,
        'I was unable to merge this PR. Please, read the logs for the last MergeBot action and try again when you solve the problem.'
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

  if (!isPullRequestMergeable(payload.pull_request, input)) {
    log(`PR #${prNumber} can't be merged. It does not have the right labels.`)
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
      isPullRequestMergeable(pr, input)
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

  await octoapi.mergePullRequest(
    payload.pull_request.number,
    payload.pull_request.head.ref,
    input.mergeMethod
  )
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

    if (input.graceTime > 0) {
      log(`Sleeping for ${input.graceTime} ms`)

      await delay(input.graceTime)
    }

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
