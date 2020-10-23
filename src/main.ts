import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks'

async function run(): Promise<void> {
  try {
    const context = github.context
    const readyToMergeLabelName = core.getInput('merge-label', {
      required: true,
    })

    if (
      context.eventName !== 'pull_request' ||
      context.payload.action !== 'labeled'
    ) {
      return
    }

    const payload = context.payload as Webhooks.EventPayloads.WebhookPayloadPullRequest
    const labels = payload.pull_request.labels

    const hasReadyToMergeLabel = labels.find(
      (label) => label.name === readyToMergeLabelName
    )
    if (!hasReadyToMergeLabel) {
      console.log(
        `Pull Request does not have the "${readyToMergeLabelName}" label. Unable to merge`
      )
      return
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
