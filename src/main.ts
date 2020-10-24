import * as core from '@actions/core'
import * as github from '@actions/github'
import { Context } from '@actions/github/lib/context'
import { GitHub } from '@actions/github/lib/utils'
import * as Webhooks from '@octokit/webhooks'
import c from 'ansi-colors'
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

const fireNextPullRequestUpdate = async (
  context: Context,
  input: Input,
  octoapi: Octoapi
) => {
  const repository = context.payload.repository
  const repositoryCompanyName = repository?.owner.name
  const repositoryUserName = repository?.owner.login

  const allOpenPullRequests = await octoapi.getAllPullRequests()

  const allPullRequestsReadyToBeMerged = allOpenPullRequests.data.filter((pr) =>
    pr.labels.some((label) => label.name === input.mergeLabelName)
  )
  let didMergeAnyPullRequest = false

  while (!didMergeAnyPullRequest && allPullRequestsReadyToBeMerged.length > 0) {
    const nextPullRequestInQueue = allPullRequestsReadyToBeMerged.shift()!

    console.log(
      `Updating next Pull Request in line, which is ${c.bold.yellow(
        `#${nextPullRequestInQueue.number}`
      )}.`
    )

    try {
      await octoapi.updatePullRequestWithBaseBranch(
        nextPullRequestInQueue.number
      )

      didMergeAnyPullRequest = true
    } catch (error) {
      console.log(
        `Unable to update Pull Request ${c.bold.yellow(
          `#${nextPullRequestInQueue.number}`
        )}.`
      )
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
    console.log('No Pull Request found ready to be merged')
  }
}

const mergePullRequestIfPossible = async (
  context: Context,
  input: Input,
  octoapi: Octoapi
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

  const pullRequest = await octoapi.getPullRequest(payload.pull_request.number)

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
    const allPullRequests = await octoapi.getAllPullRequests()

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
    await octoapi.updatePullRequestWithBaseBranch(payload.pull_request.number)
    return
  }

  console.log('Pull Request is about to be merged.')
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
      console.log('Running base branch flow')
      await fireNextPullRequestUpdate(context, input, octoapi)
    } else {
      console.log('Running Pull Request flow')
      await mergePullRequestIfPossible(context, input, octoapi)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
