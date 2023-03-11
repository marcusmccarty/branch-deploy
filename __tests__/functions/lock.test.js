import * as core from '@actions/core'
import {lock} from '../../src/functions/lock'
import * as actionStatus from '../../src/functions/action-status'

class NotFoundError extends Error {
  constructor(message) {
    super(message)
    this.status = 404
  }
}

class BigBadError extends Error {
  constructor(message) {
    super(message)
    this.status = 500
  }
}

const lockBase64Monalisa =
  'ewogICAgInJlYXNvbiI6IG51bGwsCiAgICAiYnJhbmNoIjogImNvb2wtbmV3LWZlYXR1cmUiLAogICAgImNyZWF0ZWRfYXQiOiAiMjAyMi0wNi0xNVQyMToxMjoxNC4wNDFaIiwKICAgICJjcmVhdGVkX2J5IjogIm1vbmFsaXNhIiwKICAgICJzdGlja3kiOiBmYWxzZSwKICAgICJsaW5rIjogImh0dHBzOi8vZ2l0aHViLmNvbS90ZXN0LW9yZy90ZXN0LXJlcG8vcHVsbC8zI2lzc3VlY29tbWVudC0xMjMiCn0K'

const lockBase64Octocat =
  'ewogICAgInJlYXNvbiI6ICJUZXN0aW5nIG15IG5ldyBmZWF0dXJlIHdpdGggbG90cyBvZiBjYXRzIiwKICAgICJicmFuY2giOiAib2N0b2NhdHMtZXZlcnl3aGVyZSIsCiAgICAiY3JlYXRlZF9hdCI6ICIyMDIyLTA2LTE0VDIxOjEyOjE0LjA0MVoiLAogICAgImNyZWF0ZWRfYnkiOiAib2N0b2NhdCIsCiAgICAic3RpY2t5IjogdHJ1ZSwKICAgICJsaW5rIjogImh0dHBzOi8vZ2l0aHViLmNvbS90ZXN0LW9yZy90ZXN0LXJlcG8vcHVsbC8yI2lzc3VlY29tbWVudC00NTYiCn0K'

const saveStateMock = jest.spyOn(core, 'saveState')
const setFailedMock = jest.spyOn(core, 'setFailed')
const infoMock = jest.spyOn(core, 'info')
const debugMock = jest.spyOn(core, 'debug')

const environment = 'production'

var octokit
var octokitOtherUserHasLock

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(core, 'setFailed').mockImplementation(() => {})
  jest.spyOn(core, 'saveState').mockImplementation(() => {})
  jest.spyOn(core, 'info').mockImplementation(() => {})
  jest.spyOn(core, 'debug').mockImplementation(() => {})
  process.env.INPUT_GLOBAL_LOCK_FLAG = '--global'
  process.env.INPUT_LOCK_TRIGGER = '.lock'
  process.env.INPUT_ENVIRONMENT = 'production'
  process.env.INPUT_LOCK_INFO_ALIAS = '.wcid'

  octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockRejectedValueOnce(new NotFoundError('Reference does not exist'))
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        createOrUpdateFileContents: jest.fn().mockReturnValue({}),
        getContent: jest
          .fn()
          .mockRejectedValue(new NotFoundError('file not found'))
      },
      git: {
        createRef: jest.fn().mockReturnValue({status: 201})
      },
      issues: {
        createComment: jest.fn().mockReturnValue({})
      }
    }
  }

  octokitOtherUserHasLock = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockReturnValueOnce({data: {content: lockBase64Octocat}})
      }
    }
  }
})

const context = {
  actor: 'monalisa',
  repo: {
    owner: 'corp',
    repo: 'test'
  },
  issue: {
    number: 1
  },
  payload: {
    comment: {
      body: '.lock'
    }
  }
}

const ref = 'cool-new-feature'

test('successfully obtains a deployment lock (non-sticky) by creating the branch and lock file', async () => {
  expect(await lock(octokit, context, ref, 123, false, environment)).toBe(true)
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: production-branch-deploy-lock'
  )
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
})

test('Determines that another user has the lock (GLOBAL) and exits - during a lock claim on deployment', async () => {
  const actionStatusSpy = jest
    .spyOn(actionStatus, 'actionStatus')
    .mockImplementation(() => {
      return undefined
    })
  expect(
    await lock(octokitOtherUserHasLock, context, ref, 123, false, environment)
  ).toBe(false)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
  expect(actionStatusSpy).toHaveBeenCalledWith(
    context,
    octokitOtherUserHasLock,
    123,
    expect.stringMatching(
      /Sorry __monalisa__, the deployment lock is currently claimed by __octocat__/
    )
  )
  expect(saveStateMock).toHaveBeenCalledWith('bypass', 'true')
  expect(setFailedMock).toHaveBeenCalledWith(
    expect.stringMatching(
      /Sorry __monalisa__, the deployment lock is currently claimed by __octocat__/
    )
  )
})

test('Determines that another user has the lock (non-global) and exits - during a lock claim on deployment', async () => {
  const actionStatusSpy = jest
    .spyOn(actionStatus, 'actionStatus')
    .mockImplementation(() => {
      return undefined
    })
  expect(
    await lock(octokitOtherUserHasLock, context, ref, 123, false, environment)
  ).toBe(false)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
  expect(actionStatusSpy).toHaveBeenCalledWith(
    context,
    octokitOtherUserHasLock,
    123,
    expect.stringMatching(
      /Sorry __monalisa__, the deployment lock is currently claimed by __octocat__/
    )
  )
  expect(saveStateMock).toHaveBeenCalledWith('bypass', 'true')
  expect(setFailedMock).toHaveBeenCalledWith(
    expect.stringMatching(
      /Sorry __monalisa__, the deployment lock is currently claimed by __octocat__/
    )
  )
})

test('Determines that another user has the lock (non-global) and exits - during a direct lock claim with .lock', async () => {
  const actionStatusSpy = jest
    .spyOn(actionStatus, 'actionStatus')
    .mockImplementation(() => {
      return undefined
    })
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockRejectedValueOnce(new NotFoundError('file not found'))
          .mockReturnValueOnce({data: {content: lockBase64Octocat}})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, true, environment)).toBe(false)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
  expect(actionStatusSpy).toHaveBeenCalledWith(
    context,
    octokit,
    123,
    expect.stringMatching(
      /Sorry __monalisa__, the deployment lock is currently claimed by __octocat__/
    )
  )
  expect(saveStateMock).toHaveBeenCalledWith('bypass', 'true')
  expect(setFailedMock).toHaveBeenCalledWith(
    expect.stringMatching(/Cannot claim deployment lock/)
  )
})

test('Request detailsOnly on the lock file and gets lock file data successfully', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockRejectedValueOnce(new NotFoundError('file not found')) // fails the first time looking for a global lock
          .mockReturnValueOnce({data: {content: lockBase64Octocat}}) // succeeds the second time looking for a 'local' lock for the environment
      }
    }
  }
  expect(
    await lock(octokit, context, ref, 123, null, environment, true)
  ).toStrictEqual({
    branch: 'octocats-everywhere',
    created_at: '2022-06-14T21:12:14.041Z',
    created_by: 'octocat',
    link: 'https://github.com/test-org/test-repo/pull/2#issuecomment-456',
    reason: 'Testing my new feature with lots of cats',
    sticky: true
  })
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
})

test('Request detailsOnly on the lock file and gets lock file data successfully -- .wcid', async () => {
  context.payload.comment.body = '.wcid'

  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockRejectedValueOnce(new NotFoundError('file not found')) // fails the first time looking for a global lock
          .mockReturnValueOnce({data: {content: lockBase64Octocat}}) // succeeds the second time looking for a 'local' lock for the environment
      }
    }
  }
  expect(
    await lock(octokit, context, ref, 123, null, null, true)
  ).toStrictEqual({
    branch: 'octocats-everywhere',
    created_at: '2022-06-14T21:12:14.041Z',
    created_by: 'octocat',
    link: 'https://github.com/test-org/test-repo/pull/2#issuecomment-456',
    reason: 'Testing my new feature with lots of cats',
    sticky: true
  })
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
})

test('Request detailsOnly on the lock file when the lock branch exists but no lock file exists', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockRejectedValue(new NotFoundError('file not found')),
        createOrUpdateFileContents: jest.fn().mockReturnValue({})
      },
      issues: {
        createComment: jest.fn().mockReturnValue({})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, null, environment, true)).toBe(
    null
  )
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
})

test('Request detailsOnly on the lock file when no branch exists', async () => {
  context.payload.comment.body = '.lock --details'
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockRejectedValueOnce(new NotFoundError('Reference does not exist'))
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        createOrUpdateFileContents: jest.fn().mockReturnValue({}),
        getContent: jest
          .fn()
          .mockRejectedValue(new NotFoundError('file not found'))
      },
      git: {
        createRef: jest.fn().mockReturnValue({status: 201})
      },
      issues: {
        createComment: jest.fn().mockReturnValue({})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, null, environment, true)).toBe(
    null
  )
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
})

test('Request detailsOnly on the lock file when no branch exists and hits an error when trying to check the branch', async () => {
  context.payload.comment.body = '.lock --details'
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockRejectedValueOnce(new BigBadError('oh no - 500')),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        createOrUpdateFileContents: jest.fn().mockReturnValue({}),
        getContent: jest
          .fn()
          .mockRejectedValue(new NotFoundError('file not found'))
      }
    }
  }
  try {
    await lock(octokit, context, ref, 123, null, environment, true)
  } catch (error) {
    expect(error.message).toBe('Error: oh no - 500')
    expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
    expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
    expect(debugMock).toHaveBeenCalledWith(
      `constructed lock branch: ${environment}-branch-deploy-lock`
    )
  }
})

test('Determines that the lock request is coming from current owner of the lock and exits - non-sticky', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockReturnValue({data: {content: lockBase64Monalisa}})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, false, environment)).toBe(
    'owner'
  )
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
  expect(infoMock).toHaveBeenCalledWith('monalisa is the owner of the lock')
})

test('Determines that the lock request is coming from current owner of the lock and exits - sticky', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockReturnValue({data: {content: lockBase64Monalisa}})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, true, environment)).toBe(
    'owner'
  )
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
  expect(infoMock).toHaveBeenCalledWith('monalisa is the owner of the lock')
})

test('fails to decode the lock file contents', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest.fn().mockReturnValue({data: {content: null}})
      }
    }
  }
  try {
    await lock(octokit, context, ref, 123, true, environment)
  } catch (error) {
    expect(error.message).toBe(
      'TypeError [ERR_INVALID_ARG_TYPE]: The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received null'
    )
    expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
    expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
    expect(debugMock).toHaveBeenCalledWith(
      `constructed lock branch: ${environment}-branch-deploy-lock`
    )
  }
})

test('Creates a lock when the lock branch exists but no lock file exists', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockRejectedValue(new NotFoundError('file not found')),
        createOrUpdateFileContents: jest.fn().mockReturnValue({})
      },
      issues: {
        createComment: jest.fn().mockReturnValue({})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, false, environment)).toBe(true)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
})

test('successfully obtains a deployment lock (sticky) by creating the branch and lock file - with a --reason', async () => {
  context.payload.comment.body =
    '.lock --reason testing a super cool new feature'
  expect(await lock(octokit, context, ref, 123, true, environment)).toBe(true)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
  expect(infoMock).toHaveBeenCalledWith('deployment lock is sticky')
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: production-branch-deploy-lock'
  )
})

test('successfully obtains a deployment lock (sticky) by creating the branch and lock file - with an empty --reason', async () => {
  context.payload.comment.body = '.lock --reason '
  expect(await lock(octokit, context, ref, 123, true, environment)).toBe(true)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
  expect(infoMock).toHaveBeenCalledWith('deployment lock is sticky')
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: production-branch-deploy-lock'
  )
})

test('successfully obtains a deployment lock (sticky and global) by creating the branch and lock file', async () => {
  context.payload.comment.body = '.lock --global'
  expect(await lock(octokit, context, ref, 123, true, null)).toBe(true)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: null`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: true`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: global-branch-deploy-lock`
  )
  expect(infoMock).toHaveBeenCalledWith('global lock: true')
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
  expect(infoMock).toHaveBeenCalledWith('deployment lock is sticky')
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: global-branch-deploy-lock'
  )
})

test('successfully obtains a deployment lock (sticky and global) by creating the branch and lock file with a --reason', async () => {
  context.payload.comment.body =
    '.lock --reason because something is broken --global'
  expect(await lock(octokit, context, ref, 123, true, null)).toBe(true)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: null`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: true`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: global-branch-deploy-lock`
  )
  expect(debugMock).toHaveBeenCalledWith('reason: because something is broken')
  expect(infoMock).toHaveBeenCalledWith('global lock: true')
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
  expect(infoMock).toHaveBeenCalledWith('deployment lock is sticky')
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: global-branch-deploy-lock'
  )
})

test('successfully obtains a deployment lock (sticky and global) by creating the branch and lock file with a --reason at the end of the string', async () => {
  context.payload.comment.body =
    '.lock --global  --reason because something is broken badly  '
  expect(await lock(octokit, context, ref, 123, true, null)).toBe(true)
  expect(debugMock).toHaveBeenCalledWith(
    'reason: because something is broken badly'
  )
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: null`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: true`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: global-branch-deploy-lock`
  )
  expect(infoMock).toHaveBeenCalledWith('global lock: true')
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
  expect(infoMock).toHaveBeenCalledWith('deployment lock is sticky')
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: global-branch-deploy-lock'
  )
})

test('successfully obtains a deployment lock (sticky) by creating the branch and lock file with a --reason at the end of the string', async () => {
  context.payload.comment.body =
    '.lock development  --reason because something is broken badly  '
  expect(await lock(octokit, context, ref, 123, true, null)).toBe(true)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: development`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: development-branch-deploy-lock`
  )
  expect(debugMock).toHaveBeenCalledWith(
    'reason: because something is broken badly'
  )
  expect(infoMock).toHaveBeenCalledWith('global lock: false')
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
  expect(infoMock).toHaveBeenCalledWith('deployment lock is sticky')
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: development-branch-deploy-lock'
  )
})

test('successfully obtains a deployment lock (sticky) by creating the branch and lock file with a --reason', async () => {
  context.payload.comment.body = '.lock --reason because something is broken'
  expect(await lock(octokit, context, ref, 123, true, null)).toBe(true)
  expect(debugMock).toHaveBeenCalledWith(`detected lock env: ${environment}`)
  expect(debugMock).toHaveBeenCalledWith(`detected lock global: false`)
  expect(debugMock).toHaveBeenCalledWith(
    `constructed lock branch: ${environment}-branch-deploy-lock`
  )
  expect(debugMock).toHaveBeenCalledWith('reason: because something is broken')
  expect(infoMock).toHaveBeenCalledWith('global lock: false')
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
  expect(infoMock).toHaveBeenCalledWith('deployment lock is sticky')
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: production-branch-deploy-lock'
  )
})

test('throws an error if an unhandled exception occurs', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest.fn().mockRejectedValueOnce(new Error('oh no')),
        getContent: jest.fn().mockRejectedValue(new Error('oh no'))
      }
    }
  }
  try {
    await lock(octokit, context, ref, 123, true, environment)
  } catch (e) {
    expect(e.message).toBe('Error: oh no')
  }
})
