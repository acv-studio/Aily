import {expect,it} from 'vitest'
import {calculateChatViewport as frame} from './chatViewport'
it('follows a normal full screen',()=>expect(frame({layoutHeight:874,visualHeight:874})).toEqual({top:0,height:874,keyboardOpen:false}))
it('accounts for native keyboard even when WK visualViewport does not shrink',()=>expect(frame({layoutHeight:874,visualHeight:874,nativeKeyboardHeight:376,fullHeight:874})).toEqual({top:0,height:498,keyboardOpen:true}))
it('does not double subtract native and visual viewport keyboard occlusion',()=>expect(frame({layoutHeight:874,visualHeight:498,nativeKeyboardHeight:376,fullHeight:874})).toEqual({top:0,height:498,keyboardOpen:true}))
it('does not double subtract when native resize shortens window innerHeight too',()=>expect(frame({layoutHeight:498,visualHeight:498,nativeKeyboardHeight:376,fullHeight:874})).toEqual({top:0,height:498,keyboardOpen:true}))
it('keeps bottom above keyboard when visual viewport pans',()=>expect(frame({layoutHeight:874,visualHeight:438,visualTop:60,nativeKeyboardHeight:376,fullHeight:874})).toEqual({top:60,height:438,keyboardOpen:true}))
it('supports browser-only keyboard resizing',()=>expect(frame({layoutHeight:874,visualHeight:498})).toEqual({top:0,height:498,keyboardOpen:true}))
it('restores the screen when keyboard hides',()=>expect(frame({layoutHeight:874,visualHeight:874,nativeKeyboardHeight:0,fullHeight:874}).height).toBe(874))
it('handles landscape native resizing without extra subtraction',()=>expect(frame({layoutHeight:186,visualHeight:186,nativeKeyboardHeight:216,fullHeight:402}).height).toBe(186))
it('trusts the resized layout for an unseen orientation baseline',()=>expect(frame({layoutHeight:186,visualHeight:186,nativeKeyboardHeight:216,fullHeight:0})).toEqual({top:0,height:186,keyboardOpen:true}))
it('ignores invalid native and visual dimensions safely',()=>expect(frame({layoutHeight:874,visualHeight:NaN,nativeKeyboardHeight:NaN,visualTop:NaN})).toEqual({top:0,height:874,keyboardOpen:false}))
