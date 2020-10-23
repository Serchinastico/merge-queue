import * as core from '@actions/core'
import * as github from '@actions/github'

async function run(): Promise<void> {
  try {
    const context = github.context

    core.debug(`Payload > Action: ${context.payload.action}`)
    core.debug(`Event name: ${context.eventName}`)
    core.setOutput('debug', JSON.stringify(context))
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
