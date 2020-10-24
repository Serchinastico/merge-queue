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

  const nextPullRequestInQueue = allOpenPullRequests.data.find((pr) =>
    pr.labels.some((label) => label.name === input.mergeLabelName)
  )

  if (nextPullRequestInQueue) {
    console.log(
      `Next Pull Request in line is ${c.bold.yellow(
        `#${nextPullRequestInQueue.number}`
      )}. Updating it.`
    )

    await octokit.pulls.updateBranch({
      owner,
      repo,
      pull_number: nextPullRequestInQueue.number,
    })
  }
}

const run = async (): Promise<void> => {
  try {
    const context = github.context
    const input = getInput()
    const octokit = github.getOctokit(input.githubToken)

    if (isEventInBaseBranch(context)) {
      await fireNextPullRequestUpdate(context, input, octokit)
    } else {
      const payload = context.payload as Webhooks.EventPayloads.WebhookPayloadPullRequest
      const labels = payload.pull_request.labels

      const hasReadyToMergeLabel = labels.find(
        (label) => label.name === input.mergeLabelName
      )
      if (!hasReadyToMergeLabel) {
        console.log(
          `Pull Request does not have the "${input.mergeLabelName}" label. Unable to merge`
        )
        return
      }

      const pullRequestId = {
        owner: payload.repository.owner.name ?? payload.repository.owner.login,
        repo: payload.repository.name,
        pull_number: payload.pull_request.number,
      }
      console.log('Payload')
      console.log(payload)
      console.log(pullRequestId)

      const pullRequest = await octokit.pulls.get(pullRequestId)

      console.log('Pull Request')
      console.log(pullRequest)

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

        console.log('First pull request is:')
        console.log(firstPullRequestInQueue)
        console.log(firstPullRequestInQueue?.id)
        console.log(pullRequest.data.id)

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
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
