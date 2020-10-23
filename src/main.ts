import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks'

type MergeMethod = 'merge' | 'rebase' | 'squash'
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

const run = async (): Promise<void> => {
  try {
    const context = github.context
    const readyToMergeLabelName = core.getInput('merge-label', {
      required: true,
    })
    const githubToken = core.getInput('github-token', { required: true })
    const untypedMergeMethod = core.getInput('merge-method', { required: true })
    const baseBranchName = core.getInput('base-branch', { required: true })

    const mergeMethod = mapMergeMethod(untypedMergeMethod)

    if (
      context.eventName !== 'pull_request' ||
      context.payload.action !== 'labeled'
    ) {
      return
    }

    const payload = context.payload as Webhooks.EventPayloads.WebhookPayloadPullRequest
    const labels = payload.pull_request.labels
    const octokit = github.getOctokit(githubToken)

    const hasReadyToMergeLabel = labels.find(
      (label) => label.name === readyToMergeLabelName
    )
    if (!hasReadyToMergeLabel) {
      console.log(
        `Pull Request does not have the "${readyToMergeLabelName}" label. Unable to merge`
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
        base: baseBranchName,
        sort: 'created',
        direction: 'asc',
      })

      const firstPullRequestInQueue = allPullRequests.data.find((pr) =>
        pr.labels.find((label) => label.name === readyToMergeLabelName)
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
    await octokit.pulls.merge({ ...pullRequestId, merge_method: mergeMethod })
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
