// ==UserScript==
// @name         AF3 Auto Submitter V2.24 (完成汇总)
// @namespace    http://tampermonkey.net/
// @version      2.24
// @description  全能版：自动识别模式。稳定版，包含轻量多语言、运行前安全摘要、完成统计、失败任务汇总、暂停/停止控制、可折叠运行日志和拖动位置保存。
// @author       Jiang Siyuan
// @match        https://alphafoldserver.com/*
// @match        https://www.alphafoldserver.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    const CONTAINER_ID = 'af3-v20-panel';
    const PANEL_ROOT_ID = 'af3-v20-panel-root';
    const PANEL_POSITION_KEY = `${CONTAINER_ID}-position`;
    const LANGUAGE_KEY = `${CONTAINER_ID}-language`;
    const WAIT_FOR_MODAL = 2000;
    const WAIT_FOR_PAGE_LOAD = 3000; // 跳转等待时间
    // -----------

    const LANGUAGES = [
        ['zh', '中文'],
        ['en', 'English'],
        ['ja', '日本語'],
        ['ko', '한국어'],
        ['es', 'Español'],
        ['fr', 'Français']
    ];

    const I18N = {
        zh: {
            headerDev: '🧪 AF3 自动助手 DEV',
            headerProd: '🤖 AF3 自动助手',
            languageTitle: '界面语言',
            initializing: '初始化...',
            startButton: '🚀 启动',
            runningButton: '运行中...',
            pausedButton: '已暂停',
            stoppingButton: '停止中...',
            pauseButton: '暂停',
            resumeButton: '继续',
            stopButton: '停止',
            logLabel: '日志',
            devFooter: '⚠️ DEV测试版：请禁用正式版后测试',
            modeDraftFooter: '模式: 批量提交 Saved Drafts',
            modeFailedFooter: '模式: Clone & Resubmit',
            standbyFooter: '请在下方列表中仅保留 Saved draft/Failed 列表',
            readyDraftStatus: '🟢 就绪: 提交草稿',
            readyFailedStatus: '🔵 就绪: 失败任务重跑',
            standbyStatus: '😴 待机中: 请切换页面',
            modeDraft: '批量提交 Saved Drafts',
            modeFailed: '失败任务 Clone & Resubmit',
            modeUnknown: '未识别',
            batchStopped: '批处理已停止',
            batchError: '批处理异常结束',
            batchDone: '批处理结束',
            reason: '原因：{detail}',
            summaryDone: '完成：{count} 个',
            summarySkipped: '跳过：{count} 个',
            summaryFailed: '失败：{count} 个',
            skippedTasksTitle: '跳过的任务：',
            failedTasksTitle: '失败的任务：',
            taskSummaryLine: '- {label}：{reason}',
            moreTasks: '还有 {count} 个未显示，请展开日志查看。',
            viewLogsHint: '如需查看原因，请展开面板日志。',
            runSummaryLog: '运行汇总：完成 {success}，跳过 {skipped}，错误 {errors}',
            stopRequested: '收到停止请求，当前步骤结束后停止',
            pausedLog: '已暂停，点击继续恢复',
            resumedLog: '继续运行',
            userStoppedError: '用户已停止',
            noRowsAlert: '当前页面没有识别到可处理的任务行。',
            noRowsLog: '启动取消：未识别到可处理任务行',
            confirmTitle: '运行前确认',
            confirmMode: '当前模式：{mode}',
            confirmRows: '识别到任务行：{count}',
            confirmPlan: '计划处理数量：{count}',
            confirmPrompt: '请确认当前列表和数量无误。',
            userCancelled: '用户取消启动',
            startConfirmed: '启动确认：{mode}，计划处理 {planned} 个，当前识别 {rows} 行',
            clickRowMenu: '点击行菜单按钮',
            lookingClone: '寻找 Clone and reuse 选项',
            foundClone: '找到 Clone and reuse，准备点击',
            backFailedTab: '尝试切回 Failed 列表',
            draftProgress: '草稿提交：处理第 {current} / {total} 个，当前识别 {rows} 行',
            listEmptyDetail: '列表已空，已停止处理。',
            listEmptyLog: '列表已空，停止处理',
            foundContinue: '找到 Continue and preview job，准备点击',
            missingContinue: '未找到 Continue 按钮，跳过当前行',
            quotaFull: '配额已满',
            missingConfirm: 'Confirm 未出现，跳过当前行',
            foundConfirm: '找到 Confirm and submit，准备提交',
            draftDone: '第 {index} 个草稿提交完成',
            draftUnconfirmed: '第 {index} 个草稿提交后未确认列表更新',
            draftStopped: '草稿提交停止：{message}',
            failedProgress: '失败重跑：处理第 {current} / {total} 个',
            failedAllDoneDetail: '已处理完当前页所有 Failed 任务。',
            failedAllDoneLog: '已处理完当前页所有 Failed 任务',
            missingMenu: '第 {index} 行找不到菜单按钮，跳过',
            missingClone: '第 {index} 行未找到 Clone 选项，跳过',
            missingCloneContinue: 'Clone 后未找到 Continue 按钮，跳过当前任务',
            missingConfirmError: '提交确认框未弹出',
            failedSubmitted: '第 {index} 个失败任务已提交',
            failedStopped: '失败重跑停止：{message}',
            runStarted: '运行开始',
            runEnded: '运行结束'
        },
        en: {
            headerDev: '🧪 AF3 Auto Submitter DEV',
            headerProd: '🤖 AF3 Auto Submitter',
            languageTitle: 'Language',
            initializing: 'Initializing...',
            startButton: '🚀 Start',
            runningButton: 'Running...',
            pausedButton: 'Paused',
            stoppingButton: 'Stopping...',
            pauseButton: 'Pause',
            resumeButton: 'Resume',
            stopButton: 'Stop',
            logLabel: 'Log',
            devFooter: '⚠️ DEV build: disable the stable script while testing',
            modeDraftFooter: 'Mode: Submit Saved Drafts',
            modeFailedFooter: 'Mode: Clone & Resubmit',
            standbyFooter: 'Open a Saved draft or Failed list below',
            readyDraftStatus: '🟢 Ready: submit drafts',
            readyFailedStatus: '🔵 Ready: rerun failed jobs',
            standbyStatus: '😴 Idle: switch page',
            modeDraft: 'Submit Saved Drafts',
            modeFailed: 'Clone & Resubmit failed jobs',
            modeUnknown: 'Not recognized',
            batchStopped: 'Batch stopped',
            batchError: 'Batch ended with an error',
            batchDone: 'Batch finished',
            reason: 'Reason: {detail}',
            summaryDone: 'Completed: {count}',
            summarySkipped: 'Skipped: {count}',
            summaryFailed: 'Failed: {count}',
            skippedTasksTitle: 'Skipped tasks:',
            failedTasksTitle: 'Failed tasks:',
            taskSummaryLine: '- {label}: {reason}',
            moreTasks: '{count} more not shown. Expand the log for details.',
            viewLogsHint: 'Expand the panel log for details.',
            runSummaryLog: 'Run summary: completed {success}, skipped {skipped}, errors {errors}',
            stopRequested: 'Stop requested; stopping after the current step',
            pausedLog: 'Paused; click Resume to continue',
            resumedLog: 'Resumed',
            userStoppedError: 'User stopped the run',
            noRowsAlert: 'No processable task rows were detected on this page.',
            noRowsLog: 'Start cancelled: no processable task rows detected',
            confirmTitle: 'Pre-run confirmation',
            confirmMode: 'Mode: {mode}',
            confirmRows: 'Detected rows: {count}',
            confirmPlan: 'Planned jobs: {count}',
            confirmPrompt: 'Confirm that the current list and count are correct.',
            userCancelled: 'User cancelled start',
            startConfirmed: 'Start confirmed: {mode}, planned {planned}, detected {rows} rows',
            clickRowMenu: 'Clicked row menu button',
            lookingClone: 'Looking for Clone and reuse',
            foundClone: 'Found Clone and reuse; clicking',
            backFailedTab: 'Trying to switch back to the Failed list',
            draftProgress: 'Draft submit: processing {current} / {total}, detected {rows} rows',
            listEmptyDetail: 'The list is empty; processing stopped.',
            listEmptyLog: 'List is empty; stopping',
            foundContinue: 'Found Continue and preview job; clicking',
            missingContinue: 'Continue button not found; skipping this row',
            quotaFull: 'Daily quota reached',
            missingConfirm: 'Confirm button did not appear; skipping this row',
            foundConfirm: 'Found Confirm and submit; submitting',
            draftDone: 'Draft {index} submitted',
            draftUnconfirmed: 'Draft {index} submitted but list update was not confirmed',
            draftStopped: 'Draft submission stopped: {message}',
            failedProgress: 'Failed rerun: processing {current} / {total}',
            failedAllDoneDetail: 'All Failed jobs on the current page have been processed.',
            failedAllDoneLog: 'All Failed jobs on the current page have been processed',
            missingMenu: 'Row {index} has no menu button; skipping',
            missingClone: 'Row {index} has no Clone option; skipping',
            missingCloneContinue: 'Continue button not found after clone; skipping this job',
            missingConfirmError: 'Submit confirmation dialog did not appear',
            failedSubmitted: 'Failed job {index} submitted',
            failedStopped: 'Failed rerun stopped: {message}',
            runStarted: 'Run started',
            runEnded: 'Run ended'
        },
        ja: {
            headerDev: '🧪 AF3 自動送信 DEV',
            headerProd: '🤖 AF3 自動送信',
            languageTitle: '言語',
            initializing: '初期化中...',
            startButton: '🚀 開始',
            runningButton: '実行中...',
            pausedButton: '一時停止中',
            stoppingButton: '停止中...',
            pauseButton: '一時停止',
            resumeButton: '再開',
            stopButton: '停止',
            logLabel: 'ログ',
            devFooter: '⚠️ DEV版: テスト時は正式版を無効にしてください',
            modeDraftFooter: 'モード: Saved Drafts 一括送信',
            modeFailedFooter: 'モード: Clone & Resubmit',
            standbyFooter: '下のリストを Saved draft / Failed にしてください',
            readyDraftStatus: '🟢 準備完了: 下書きを送信',
            readyFailedStatus: '🔵 準備完了: 失敗ジョブを再実行',
            standbyStatus: '😴 待機中: ページを切り替えてください',
            modeDraft: 'Saved Drafts 一括送信',
            modeFailed: '失敗ジョブの Clone & Resubmit',
            modeUnknown: '未認識',
            batchStopped: 'バッチを停止しました',
            batchError: 'バッチがエラーで終了しました',
            batchDone: 'バッチ完了',
            reason: '理由：{detail}',
            summaryDone: '完了：{count}',
            summarySkipped: 'スキップ：{count}',
            summaryFailed: '失敗：{count}',
            skippedTasksTitle: 'スキップしたタスク：',
            failedTasksTitle: '失敗したタスク：',
            taskSummaryLine: '- {label}：{reason}',
            moreTasks: 'ほか {count} 件は未表示です。ログを展開してください。',
            viewLogsHint: '理由を確認するにはパネルのログを展開してください。',
            runSummaryLog: '実行サマリー：完了 {success}、スキップ {skipped}、エラー {errors}',
            stopRequested: '停止要求を受け取りました。現在の手順後に停止します',
            pausedLog: '一時停止しました。再開で続行します',
            resumedLog: '再開しました',
            userStoppedError: 'ユーザーが停止しました',
            noRowsAlert: '処理可能なタスク行が見つかりません。',
            noRowsLog: '開始をキャンセル：処理可能な行がありません',
            confirmTitle: '実行前確認',
            confirmMode: 'モード：{mode}',
            confirmRows: '検出行数：{count}',
            confirmPlan: '処理予定数：{count}',
            confirmPrompt: '現在のリストと件数が正しいことを確認してください。',
            userCancelled: 'ユーザーが開始をキャンセルしました',
            startConfirmed: '開始確認：{mode}、予定 {planned}、検出 {rows} 行',
            clickRowMenu: '行メニューをクリック',
            lookingClone: 'Clone and reuse を検索中',
            foundClone: 'Clone and reuse を検出、クリックします',
            backFailedTab: 'Failed リストへ戻ります',
            draftProgress: '下書き送信：{current} / {total}、検出 {rows} 行',
            listEmptyDetail: 'リストが空のため停止しました。',
            listEmptyLog: 'リストが空です。停止します',
            foundContinue: 'Continue and preview job を検出、クリックします',
            missingContinue: 'Continue ボタンが見つからないためスキップ',
            quotaFull: '日次クォータに達しました',
            missingConfirm: 'Confirm が表示されないためスキップ',
            foundConfirm: 'Confirm and submit を検出、送信します',
            draftDone: '下書き {index} を送信しました',
            draftUnconfirmed: '下書き {index} の送信後、リスト更新を確認できません',
            draftStopped: '下書き送信を停止：{message}',
            failedProgress: '失敗再実行：{current} / {total}',
            failedAllDoneDetail: '現在のページの Failed ジョブはすべて処理済みです。',
            failedAllDoneLog: '現在のページの Failed ジョブはすべて処理済みです',
            missingMenu: '{index} 行目にメニューボタンがないためスキップ',
            missingClone: '{index} 行目に Clone がないためスキップ',
            missingCloneContinue: 'Clone 後に Continue が見つからないためスキップ',
            missingConfirmError: '送信確認ダイアログが表示されません',
            failedSubmitted: '失敗ジョブ {index} を送信しました',
            failedStopped: '失敗再実行を停止：{message}',
            runStarted: '実行開始',
            runEnded: '実行終了'
        },
        ko: {
            headerDev: '🧪 AF3 자동 제출 DEV',
            headerProd: '🤖 AF3 자동 제출',
            languageTitle: '언어',
            initializing: '초기화 중...',
            startButton: '🚀 시작',
            runningButton: '실행 중...',
            pausedButton: '일시정지됨',
            stoppingButton: '중지 중...',
            pauseButton: '일시정지',
            resumeButton: '계속',
            stopButton: '중지',
            logLabel: '로그',
            devFooter: '⚠️ DEV 버전: 테스트 중에는 정식 버전을 비활성화하세요',
            modeDraftFooter: '모드: Saved Drafts 일괄 제출',
            modeFailedFooter: '모드: Clone & Resubmit',
            standbyFooter: '아래 목록을 Saved draft 또는 Failed 로 유지하세요',
            readyDraftStatus: '🟢 준비됨: 초안 제출',
            readyFailedStatus: '🔵 준비됨: 실패 작업 재실행',
            standbyStatus: '😴 대기 중: 페이지를 전환하세요',
            modeDraft: 'Saved Drafts 일괄 제출',
            modeFailed: '실패 작업 Clone & Resubmit',
            modeUnknown: '인식되지 않음',
            batchStopped: '배치가 중지됨',
            batchError: '배치가 오류로 종료됨',
            batchDone: '배치 완료',
            reason: '이유: {detail}',
            summaryDone: '완료: {count}',
            summarySkipped: '건너뜀: {count}',
            summaryFailed: '실패: {count}',
            skippedTasksTitle: '건너뛴 작업:',
            failedTasksTitle: '실패한 작업:',
            taskSummaryLine: '- {label}: {reason}',
            moreTasks: '{count}개 더 있습니다. 자세한 내용은 로그를 펼쳐 확인하세요.',
            viewLogsHint: '자세한 내용은 패널 로그를 펼쳐 확인하세요.',
            runSummaryLog: '실행 요약: 완료 {success}, 건너뜀 {skipped}, 오류 {errors}',
            stopRequested: '중지 요청을 받았습니다. 현재 단계 후 중지합니다',
            pausedLog: '일시정지됨. 계속을 눌러 재개하세요',
            resumedLog: '재개됨',
            userStoppedError: '사용자가 중지했습니다',
            noRowsAlert: '처리할 수 있는 작업 행을 찾지 못했습니다.',
            noRowsLog: '시작 취소: 처리 가능한 작업 행 없음',
            confirmTitle: '실행 전 확인',
            confirmMode: '모드: {mode}',
            confirmRows: '감지된 행: {count}',
            confirmPlan: '처리 예정: {count}',
            confirmPrompt: '현재 목록과 개수가 올바른지 확인하세요.',
            userCancelled: '사용자가 시작을 취소했습니다',
            startConfirmed: '시작 확인: {mode}, 예정 {planned}, 감지 {rows}행',
            clickRowMenu: '행 메뉴 버튼 클릭',
            lookingClone: 'Clone and reuse 찾는 중',
            foundClone: 'Clone and reuse 발견, 클릭합니다',
            backFailedTab: 'Failed 목록으로 돌아가는 중',
            draftProgress: '초안 제출: {current} / {total}, 감지 {rows}행',
            listEmptyDetail: '목록이 비어 있어 처리를 중지했습니다.',
            listEmptyLog: '목록이 비어 있음, 중지',
            foundContinue: 'Continue and preview job 발견, 클릭합니다',
            missingContinue: 'Continue 버튼 없음, 현재 행 건너뜀',
            quotaFull: '일일 할당량에 도달했습니다',
            missingConfirm: 'Confirm 이 나타나지 않아 건너뜀',
            foundConfirm: 'Confirm and submit 발견, 제출합니다',
            draftDone: '초안 {index} 제출 완료',
            draftUnconfirmed: '초안 {index} 제출 후 목록 업데이트를 확인하지 못함',
            draftStopped: '초안 제출 중지: {message}',
            failedProgress: '실패 재실행: {current} / {total}',
            failedAllDoneDetail: '현재 페이지의 Failed 작업을 모두 처리했습니다.',
            failedAllDoneLog: '현재 페이지의 Failed 작업을 모두 처리했습니다',
            missingMenu: '{index}행에 메뉴 버튼 없음, 건너뜀',
            missingClone: '{index}행에 Clone 옵션 없음, 건너뜀',
            missingCloneContinue: 'Clone 후 Continue 버튼 없음, 건너뜀',
            missingConfirmError: '제출 확인 창이 나타나지 않았습니다',
            failedSubmitted: '실패 작업 {index} 제출 완료',
            failedStopped: '실패 재실행 중지: {message}',
            runStarted: '실행 시작',
            runEnded: '실행 종료'
        },
        es: {
            headerDev: '🧪 AF3 Auto Submitter DEV',
            headerProd: '🤖 AF3 Auto Submitter',
            languageTitle: 'Idioma',
            initializing: 'Inicializando...',
            startButton: '🚀 Iniciar',
            runningButton: 'Ejecutando...',
            pausedButton: 'Pausado',
            stoppingButton: 'Deteniendo...',
            pauseButton: 'Pausa',
            resumeButton: 'Continuar',
            stopButton: 'Detener',
            logLabel: 'Registro',
            devFooter: '⚠️ Versión DEV: desactiva la versión estable al probar',
            modeDraftFooter: 'Modo: enviar Saved Drafts',
            modeFailedFooter: 'Modo: Clone & Resubmit',
            standbyFooter: 'Abre una lista Saved draft o Failed abajo',
            readyDraftStatus: '🟢 Listo: enviar borradores',
            readyFailedStatus: '🔵 Listo: reenviar fallidos',
            standbyStatus: '😴 En espera: cambia de página',
            modeDraft: 'Enviar Saved Drafts',
            modeFailed: 'Clone & Resubmit de fallidos',
            modeUnknown: 'No reconocido',
            batchStopped: 'Lote detenido',
            batchError: 'El lote terminó con error',
            batchDone: 'Lote finalizado',
            reason: 'Motivo: {detail}',
            summaryDone: 'Completados: {count}',
            summarySkipped: 'Omitidos: {count}',
            summaryFailed: 'Fallidos: {count}',
            skippedTasksTitle: 'Tareas omitidas:',
            failedTasksTitle: 'Tareas fallidas:',
            taskSummaryLine: '- {label}: {reason}',
            moreTasks: '{count} más sin mostrar. Expande el registro para ver detalles.',
            viewLogsHint: 'Expande el registro del panel para ver detalles.',
            runSummaryLog: 'Resumen: completados {success}, omitidos {skipped}, errores {errors}',
            stopRequested: 'Detención solicitada; se detendrá tras el paso actual',
            pausedLog: 'Pausado; pulsa Continuar para seguir',
            resumedLog: 'Continuado',
            userStoppedError: 'El usuario detuvo la ejecución',
            noRowsAlert: 'No se detectaron filas de tareas procesables.',
            noRowsLog: 'Inicio cancelado: no hay filas procesables',
            confirmTitle: 'Confirmación antes de ejecutar',
            confirmMode: 'Modo: {mode}',
            confirmRows: 'Filas detectadas: {count}',
            confirmPlan: 'Tareas previstas: {count}',
            confirmPrompt: 'Confirma que la lista y el número son correctos.',
            userCancelled: 'El usuario canceló el inicio',
            startConfirmed: 'Inicio confirmado: {mode}, previstas {planned}, detectadas {rows} filas',
            clickRowMenu: 'Clic en el menú de la fila',
            lookingClone: 'Buscando Clone and reuse',
            foundClone: 'Clone and reuse encontrado; haciendo clic',
            backFailedTab: 'Intentando volver a la lista Failed',
            draftProgress: 'Enviando borrador: {current} / {total}, detectadas {rows} filas',
            listEmptyDetail: 'La lista está vacía; se detuvo el proceso.',
            listEmptyLog: 'Lista vacía; deteniendo',
            foundContinue: 'Continue and preview job encontrado; haciendo clic',
            missingContinue: 'No se encontró Continue; se omite la fila',
            quotaFull: 'Se alcanzó la cuota diaria',
            missingConfirm: 'No apareció Confirm; se omite la fila',
            foundConfirm: 'Confirm and submit encontrado; enviando',
            draftDone: 'Borrador {index} enviado',
            draftUnconfirmed: 'Borrador {index} enviado, pero no se confirmó el cambio en la lista',
            draftStopped: 'Envío de borradores detenido: {message}',
            failedProgress: 'Reenvío de fallidos: {current} / {total}',
            failedAllDoneDetail: 'Todas las tareas Failed de la página actual fueron procesadas.',
            failedAllDoneLog: 'Todas las tareas Failed de la página actual fueron procesadas',
            missingMenu: 'La fila {index} no tiene botón de menú; se omite',
            missingClone: 'La fila {index} no tiene opción Clone; se omite',
            missingCloneContinue: 'No se encontró Continue tras clonar; se omite la tarea',
            missingConfirmError: 'No apareció el diálogo de confirmación',
            failedSubmitted: 'Tarea fallida {index} enviada',
            failedStopped: 'Reenvío de fallidos detenido: {message}',
            runStarted: 'Ejecución iniciada',
            runEnded: 'Ejecución finalizada'
        },
        fr: {
            headerDev: '🧪 AF3 Auto Submitter DEV',
            headerProd: '🤖 AF3 Auto Submitter',
            languageTitle: 'Langue',
            initializing: 'Initialisation...',
            startButton: '🚀 Démarrer',
            runningButton: 'En cours...',
            pausedButton: 'En pause',
            stoppingButton: 'Arrêt...',
            pauseButton: 'Pause',
            resumeButton: 'Reprendre',
            stopButton: 'Arrêter',
            logLabel: 'Journal',
            devFooter: '⚠️ Version DEV : désactivez la version stable pendant les tests',
            modeDraftFooter: 'Mode : envoyer les Saved Drafts',
            modeFailedFooter: 'Mode : Clone & Resubmit',
            standbyFooter: 'Ouvrez une liste Saved draft ou Failed ci-dessous',
            readyDraftStatus: '🟢 Prêt : envoyer les brouillons',
            readyFailedStatus: '🔵 Prêt : relancer les échecs',
            standbyStatus: '😴 En attente : changez de page',
            modeDraft: 'Envoyer les Saved Drafts',
            modeFailed: 'Clone & Resubmit des échecs',
            modeUnknown: 'Non reconnu',
            batchStopped: 'Lot arrêté',
            batchError: 'Le lot s’est terminé avec une erreur',
            batchDone: 'Lot terminé',
            reason: 'Raison : {detail}',
            summaryDone: 'Terminés : {count}',
            summarySkipped: 'Ignorés : {count}',
            summaryFailed: 'Échecs : {count}',
            skippedTasksTitle: 'Tâches ignorées :',
            failedTasksTitle: 'Tâches en échec :',
            taskSummaryLine: '- {label} : {reason}',
            moreTasks: '{count} autres non affichées. Dépliez le journal pour les détails.',
            viewLogsHint: 'Dépliez le journal du panneau pour voir les détails.',
            runSummaryLog: 'Résumé : terminés {success}, ignorés {skipped}, erreurs {errors}',
            stopRequested: 'Arrêt demandé ; arrêt après l’étape en cours',
            pausedLog: 'En pause ; cliquez sur Reprendre pour continuer',
            resumedLog: 'Repris',
            userStoppedError: 'L’utilisateur a arrêté l’exécution',
            noRowsAlert: 'Aucune ligne de tâche traitable détectée.',
            noRowsLog: 'Démarrage annulé : aucune ligne traitable',
            confirmTitle: 'Confirmation avant exécution',
            confirmMode: 'Mode : {mode}',
            confirmRows: 'Lignes détectées : {count}',
            confirmPlan: 'Tâches prévues : {count}',
            confirmPrompt: 'Confirmez que la liste et le nombre sont corrects.',
            userCancelled: 'L’utilisateur a annulé le démarrage',
            startConfirmed: 'Démarrage confirmé : {mode}, prévues {planned}, {rows} lignes détectées',
            clickRowMenu: 'Clic sur le menu de la ligne',
            lookingClone: 'Recherche de Clone and reuse',
            foundClone: 'Clone and reuse trouvé ; clic',
            backFailedTab: 'Tentative de retour à la liste Failed',
            draftProgress: 'Envoi brouillon : {current} / {total}, {rows} lignes détectées',
            listEmptyDetail: 'La liste est vide ; traitement arrêté.',
            listEmptyLog: 'Liste vide ; arrêt',
            foundContinue: 'Continue and preview job trouvé ; clic',
            missingContinue: 'Bouton Continue introuvable ; ligne ignorée',
            quotaFull: 'Quota quotidien atteint',
            missingConfirm: 'Confirm n’est pas apparu ; ligne ignorée',
            foundConfirm: 'Confirm and submit trouvé ; envoi',
            draftDone: 'Brouillon {index} envoyé',
            draftUnconfirmed: 'Brouillon {index} envoyé, mais la mise à jour de la liste n’a pas été confirmée',
            draftStopped: 'Envoi des brouillons arrêté : {message}',
            failedProgress: 'Relance des échecs : {current} / {total}',
            failedAllDoneDetail: 'Toutes les tâches Failed de la page actuelle ont été traitées.',
            failedAllDoneLog: 'Toutes les tâches Failed de la page actuelle ont été traitées',
            missingMenu: 'La ligne {index} n’a pas de bouton de menu ; ignorée',
            missingClone: 'La ligne {index} n’a pas d’option Clone ; ignorée',
            missingCloneContinue: 'Continue introuvable après clonage ; tâche ignorée',
            missingConfirmError: 'La boîte de confirmation n’est pas apparue',
            failedSubmitted: 'Tâche échouée {index} envoyée',
            failedStopped: 'Relance des échecs arrêtée : {message}',
            runStarted: 'Exécution démarrée',
            runEnded: 'Exécution terminée'
        }
    };

    if (window.__af3AutoSubmitterV24Loaded) return;
    window.__af3AutoSubmitterV24Loaded = true;

    let isRunning = false;
    let shouldStop = false;
    let isPaused = false;
    let isDraggingPanel = false;
    let logExpanded = false;
    let currentLanguage = getSavedLanguage();
    let runProgress = {
        active: false,
        current: 0,
        total: 0,
        success: 0,
        skipped: 0,
        errors: 0,
        status: 'idle',
        skippedTasks: [],
        failedTasks: []
    };
    const logEntries = [];
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function getSavedLanguage() {
        try {
            const saved = localStorage.getItem(LANGUAGE_KEY);
            return I18N[saved] ? saved : 'zh';
        } catch (e) {
            return 'zh';
        }
    }

    function saveLanguage(lang) {
        try {
            localStorage.setItem(LANGUAGE_KEY, lang);
        } catch (e) {
            // Ignore storage errors; Chinese remains the default fallback.
        }
    }

    function t(key, vars = {}) {
        const dict = I18N[currentLanguage] || I18N.zh;
        const template = dict[key] || I18N.zh[key] || key;
        return template.replace(/\{(\w+)\}/g, (_, name) => Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : '');
    }

    function makeStoppedError() {
        const error = new Error(t('userStoppedError'));
        error.isUserStop = true;
        return error;
    }

    function isUserStopError(error) {
        return Boolean(error && error.isUserStop);
    }

    function applyLanguage() {
        const header = getUiElement('af3-header');
        const languageSelect = getUiElement('af3-language-select');
        const input = getUiElement('af3-v20-count');
        const footer = getUiElement('af3-footer-msg');
        const statusText = getUiElement('af3-status-text');

        if (header) header.textContent = t('headerProd');
        if (languageSelect) {
            languageSelect.value = currentLanguage;
            languageSelect.title = t('languageTitle');
        }
        if (input) input.title = t('confirmPlan', { count: input.value || 0 });
        renderLogPanel();
        updateRunControls();

        if (isRunning) {
            updateBtnText(isPaused ? t('pausedButton') : t('runningButton'));
        } else {
            updateBtnText(t('startButton'));
            checkSystemStatus();
        }

        if (!footer && statusText) statusText.textContent = t('initializing');
    }

    function getPanelHost() {
        return document.getElementById(CONTAINER_ID);
    }

    function getUiElement(id) {
        return getPanelHost()?.shadowRoot?.getElementById(id) || document.getElementById(id) || null;
    }

    function getSavedPanelPosition() {
        try {
            const raw = localStorage.getItem(PANEL_POSITION_KEY);
            if (!raw) return null;
            const pos = JSON.parse(raw);
            if (!Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null;
            return pos;
        } catch (e) {
            return null;
        }
    }

    function savePanelPosition(host) {
        const rect = host.getBoundingClientRect();
        try {
            localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify({
                left: Math.round(rect.left),
                top: Math.round(rect.top)
            }));
        } catch (e) {
            // localStorage can be unavailable in strict browser configurations.
        }
    }

    function applyHostStyle(host) {
        const savedPosition = getSavedPanelPosition();
        Object.assign(host.style, {
            position: 'fixed',
            zIndex: '2147483647',
            display: 'block',
            visibility: 'visible',
            opacity: '1',
            pointerEvents: 'auto',
            width: '260px',
            maxWidth: 'calc(100vw - 24px)',
            height: 'auto',
            colorScheme: 'light',
            transform: 'none'
        });

        if (isDraggingPanel) return;

        if (savedPosition) {
            const maxLeft = Math.max(12, window.innerWidth - 272);
            const maxTop = Math.max(12, window.innerHeight - 180);
            host.style.left = Math.min(Math.max(12, savedPosition.left), maxLeft) + 'px';
            host.style.top = Math.min(Math.max(12, savedPosition.top), maxTop) + 'px';
            host.style.right = 'auto';
        } else if (!host.style.left && !host.style.top) {
            host.style.top = '80px';
            host.style.right = '30px';
            host.style.left = 'auto';
        }
    }

    function addLog(message, level = 'info') {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        logEntries.push({ time, message, level });
        if (logEntries.length > 40) logEntries.shift();

        const consoleFn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
        consoleFn(`[AF3] ${message}`);
        renderLogPanel();
    }

    function startRunProgress(total) {
        runProgress = {
            active: true,
            current: 0,
            total,
            success: 0,
            skipped: 0,
            errors: 0,
            status: 'running',
            skippedTasks: [],
            failedTasks: []
        };
    }

    function setProgressCurrent(current) {
        runProgress.current = Math.min(current, runProgress.total || current);
    }

    function getTaskLabel(row, fallback) {
        const text = row?.textContent?.replace(/\s+/g, ' ').trim();
        if (!text) return fallback;
        return text.length > 80 ? `${text.slice(0, 77)}...` : text;
    }

    function recordProgressResult(type, task = {}) {
        const entry = {
            label: task.label || '-',
            reason: task.reason || ''
        };
        if (type === 'success') runProgress.success++;
        if (type === 'skipped') {
            runProgress.skipped++;
            runProgress.skippedTasks.push(entry);
        }
        if (type === 'error') {
            runProgress.errors++;
            runProgress.failedTasks.push(entry);
        }
    }

    function formatTaskList(titleKey, tasks) {
        if (!tasks.length) return '';
        const visible = tasks.slice(0, 5).map(task => t('taskSummaryLine', {
            label: task.label,
            reason: task.reason || '-'
        }));
        if (tasks.length > visible.length) {
            visible.push(t('moreTasks', { count: tasks.length - visible.length }));
        }
        return `\n\n${t(titleKey)}\n${visible.join('\n')}`;
    }

    function finishRunProgress(status, detail = '') {
        runProgress.active = false;
        runProgress.status = status;

        const title = status === 'stopped'
            ? t('batchStopped')
            : status === 'error'
                ? t('batchError')
                : t('batchDone');
        const detailText = detail ? `\n\n${t('reason', { detail })}` : '';
        const summary =
            `${title}\n\n` +
            `${t('summaryDone', { count: runProgress.success })}\n` +
            `${t('summarySkipped', { count: runProgress.skipped })}\n` +
            `${t('summaryFailed', { count: runProgress.errors })}` +
            formatTaskList('failedTasksTitle', runProgress.failedTasks) +
            formatTaskList('skippedTasksTitle', runProgress.skippedTasks) +
            `${detailText}\n\n` +
            t('viewLogsHint');

        addLog(t('runSummaryLog', {
            success: runProgress.success,
            skipped: runProgress.skipped,
            errors: runProgress.errors
        }));
        alert(summary);
    }

    function renderLogPanel() {
        const toggle = getUiElement('af3-log-toggle');
        const body = getUiElement('af3-log-body');

        if (toggle) toggle.textContent = `${logExpanded ? '▼' : '▶'} ${t('logLabel')} (${logEntries.length})`;
        if (!body) return;

        body.style.display = logExpanded ? 'block' : 'none';
        body.textContent = logEntries.map(entry => `[${entry.time}] ${entry.message}`).join('\n');
        if (logExpanded) body.scrollTop = body.scrollHeight;
    }

    function toggleLogPanel() {
        logExpanded = !logExpanded;
        renderLogPanel();
    }

    function requestStop() {
        if (!isRunning) return;
        shouldStop = true;
        isPaused = false;
        addLog(t('stopRequested'), 'warn');
        updateBtnText(t('stoppingButton'));
        updateRunControls();
    }

    function togglePause() {
        if (!isRunning) return;
        isPaused = !isPaused;
        addLog(isPaused ? t('pausedLog') : t('resumedLog'));
        updateBtnText(isPaused ? t('pausedButton') : t('runningButton'));
        updateRunControls();
    }

    function checkStop() {
        if (shouldStop) throw makeStoppedError();
    }

    async function waitIfPaused() {
        while (isPaused && !shouldStop) {
            updateBtnText(t('pausedButton'));
            await sleep(300);
        }
        checkStop();
    }

    async function controlledSleep(ms) {
        let elapsed = 0;
        while (elapsed < ms) {
            await waitIfPaused();
            const step = Math.min(250, ms - elapsed);
            await sleep(step);
            elapsed += step;
        }
        checkStop();
    }

    function getModeLabel() {
        if (currentMode === 'DRAFT') return t('modeDraft');
        if (currentMode === 'FAILED') return t('modeFailed');
        return t('modeUnknown');
    }

    function confirmStart(maxJobs) {
        const rows = getRows();
        const rowCount = rows.length;
        const plannedJobs = Math.min(maxJobs, rowCount);

        if (rowCount === 0) {
            alert(t('noRowsAlert'));
            addLog(t('noRowsLog'), 'warn');
            return 0;
        }

        const ok = confirm(
            `${t('confirmTitle')}\n\n` +
            `${t('confirmMode', { mode: getModeLabel() })}\n` +
            `${t('confirmRows', { count: rowCount })}\n` +
            `${t('confirmPlan', { count: plannedJobs })}\n\n` +
            t('confirmPrompt')
        );

        if (!ok) {
            addLog(t('userCancelled'));
            return 0;
        }

        addLog(t('startConfirmed', { mode: getModeLabel(), planned: plannedJobs, rows: rowCount }));
        return plannedJobs;
    }

    // --- 通用查找工具 ---
    function findButtonByText(text) {
        const els = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
        return els.find(el =>
            el.textContent &&
            el.textContent.toLowerCase().includes(text.toLowerCase()) &&
            !el.disabled &&
            el.offsetParent !== null
        );
    }

    // 获取列表行 (兼容 Draft 和 Failed 页面)
    function getRows() {
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        const listItems = checkboxes.map(cb => {
            let parent = cb.parentElement;
            while(parent && parent.tagName !== 'TR' && !parent.getAttribute('role')?.includes('row') && parent.className.indexOf('row') === -1) {
                parent = parent.parentElement;
                if (!parent || parent === document.body) return null;
            }
            return parent;
        }).filter(row => row !== null);
        return [...new Set(listItems)].filter(r => !r.textContent.includes('Name'));
    }

    // 强力点击
    function simulateClick(element, color = 'rgba(255, 0, 0, 0.3)') {
        if (!element) return;
        const originalBg = element.style.backgroundColor;
        const originalTrans = element.style.transition;

        // 视觉反馈
        element.style.backgroundColor = color;
        element.style.transition = 'background 0.2s';
        setTimeout(() => {
            element.style.backgroundColor = originalBg;
            element.style.transition = originalTrans;
        }, 300);

        // 完整事件链
        const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
        element.dispatchEvent(new MouseEvent('mouseover', opts));
        element.dispatchEvent(new MouseEvent('mousedown', opts));
        element.dispatchEvent(new MouseEvent('mouseup', opts));
        element.click();
    }

    // --- 失败重跑特有逻辑 ---

    // 1. 点击某行的“三点”菜单
    async function clickMenuOnRow(row) {
        // 策略：找行内的 button，通常最后一个是菜单
        const buttons = Array.from(row.querySelectorAll('button'));
        if (buttons.length === 0) return false;

        const menuBtn = buttons[buttons.length - 1];

        addLog(t('clickRowMenu'));
        simulateClick(menuBtn, 'rgba(0, 0, 255, 0.3)');
        return true;
    }

    // 2. 【核心修复】全屏搜索 "Clone and reuse" 文字并点击
    async function clickCloneOption() {
        addLog(t('lookingClone'));

        // 轮询机制：菜单弹出可能有动画，我们给它 2秒 时间反复找
        for(let i = 0; i < 10; i++) {
            await controlledSleep(200); // 每次等 200ms

            // 搜索策略：不局限于 li/div，直接找包含文字的“最小节点”
            // 很多框架把文字放在 span 里，span 放在 div 里，div 放在 li 里
            // 我们找到文字节点，然后往上找最近的可点击元素

            // 获取所有包含 "Clone and reuse" 的元素
            // 这里使用 TreeWalker 或者简单的 querySelectorAll 遍历效率稍低但稳
            // 简单点：找 body 下所有包含该文本的元素

            const allElements = document.body.querySelectorAll('*');
            let target = null;

            for (let el of allElements) {
                // 必须是肉眼可见的
                if (el.offsetParent === null) continue;

                // 只有当它是“叶子节点”（没有子标签）且包含文字时，才是我们要找的最底层元素
                if (el.children.length === 0 && el.textContent && el.textContent.includes("Clone and reuse")) {
                    target = el;
                    break;
                }
            }

            if (target) {
                // 找到了文字节点（比如 span）。
                // 尝试点击它，或者它的父级菜单项。
                // 为了保险，我们优先找它的 li 或 role="menuitem" 父级
                const clickable = target.closest('li') || target.closest('[role="menuitem"]') || target.closest('button') || target;

                addLog(t('foundClone'));
                simulateClick(clickable, 'rgba(0, 255, 0, 0.5)'); // 绿色高亮
                return true;
            }
        }

        return false;
    }

    // 3. 返回 Failed 列表页
    async function backToFailedTab() {
        addLog(t('backFailedTab'));
        const tabs = Array.from(document.querySelectorAll('button[role="tab"], div[role="tab"]'));
        const failedTab = tabs.find(t => t.textContent.includes("Failed"));

        if (failedTab) {
            simulateClick(failedTab);
            return true;
        }
        return false;
    }

    // --- UI 拖拽 ---
    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = handle || element.querySelector('#af3-header');
        if (!header) return;
        header.onmousedown = dragMouseDown;
        function dragMouseDown(e) {
            e = e || window.event; e.preventDefault();
            const currentLeft = element.offsetLeft;
            const currentTop = element.offsetTop;
            element.style.left = currentLeft + "px";
            element.style.top = currentTop + "px";
            element.style.right = "auto";
            pos3 = e.clientX; pos4 = e.clientY;
            isDraggingPanel = true;
            document.onmouseup = closeDragElement; document.onmousemove = elementDrag;
            element.style.cursor = 'grabbing';
        }
        function elementDrag(e) {
            e = e || window.event; e.preventDefault();
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
        }
        function closeDragElement() {
            document.onmouseup = null; document.onmousemove = null;
            savePanelPosition(element);
            isDraggingPanel = false;
            element.style.cursor = 'default';
        }
    }

    function stylePanelButton(button, backgroundColor, color = '#fff') {
        Object.assign(button.style, {
            padding: '7px 8px',
            backgroundColor,
            color,
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '12px',
            transition: 'all 0.2s'
        });
    }

    // --- UI ---
    function ensureUI() {
        if (!document.documentElement || !document.body) return;

        let host = getPanelHost();
        if (host?.shadowRoot?.getElementById(PANEL_ROOT_ID)) {
            applyHostStyle(host);
            return;
        }

        if (host) host.remove();

        host = document.createElement('div');
        host.id = CONTAINER_ID;
        host.setAttribute('data-af3-auto-submitter', 'true');
        applyHostStyle(host);

        const shadow = host.attachShadow({ mode: 'open' });
        const container = document.createElement('div');
        container.id = PANEL_ROOT_ID;
        Object.assign(container.style, {
            all: 'initial',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            width: '100%',
            padding: '15px',
            backgroundColor: 'rgba(32, 33, 36, 0.97)',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            border: '1px solid #5f6368',
            fontFamily: 'Roboto, Arial, sans-serif',
            color: '#fff',
            lineHeight: 'normal'
        });

        const header = document.createElement('div');
        header.id = 'af3-header';
        Object.assign(header.style, {
            textAlign: 'center', cursor: 'move', paddingBottom: '8px',
            borderBottom: '1px solid #444', fontWeight: 'bold', color: '#eee', fontSize: '14px'
        });
        header.textContent = t('headerProd');

        const languageRow = document.createElement('div');
        Object.assign(languageRow.style, {
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '-4px',
            marginBottom: '-2px'
        });
        const languageSelect = document.createElement('select');
        languageSelect.id = 'af3-language-select';
        languageSelect.title = t('languageTitle');
        LANGUAGES.forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            languageSelect.appendChild(option);
        });
        languageSelect.value = currentLanguage;
        Object.assign(languageSelect.style, {
            width: '86px',
            padding: '2px 4px',
            borderRadius: '4px',
            border: '1px solid #3c4043',
            backgroundColor: '#2b2c30',
            color: '#cfd2d6',
            fontSize: '10px',
            outline: 'none'
        });
        languageSelect.onchange = () => {
            currentLanguage = I18N[languageSelect.value] ? languageSelect.value : 'zh';
            saveLanguage(currentLanguage);
            applyLanguage();
        };
        languageRow.appendChild(languageSelect);

        const statusRow = document.createElement('div');
        Object.assign(statusRow.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' });
        const statusLight = document.createElement('div');
        statusLight.id = 'af3-status-light';
        Object.assign(statusLight.style, {
            width: '10px', height: '10px', borderRadius: '50%',
            backgroundColor: '#f44336', flexShrink: '0', transition: 'all 0.3s'
        });
        const statusText = document.createElement('span');
        statusText.id = 'af3-status-text';
        statusText.textContent = t('initializing');
        Object.assign(statusText.style, { fontSize: '12px', color: '#bbb', whiteSpace: 'nowrap' });
        statusRow.appendChild(statusLight); statusRow.appendChild(statusText);

        const controls = document.createElement('div');
        Object.assign(controls.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const input = document.createElement('input');
        input.type = 'number'; input.value = '10'; input.id = 'af3-v20-count';
        Object.assign(input.style, {
            width: '50px', padding: '8px', borderRadius: '6px', border: '1px solid #555',
            textAlign: 'center', fontWeight: 'bold', backgroundColor: '#333', color: '#fff'
        });
        const btn = document.createElement('button');
        btn.id = 'af3-v20-btn'; btn.textContent = t('startButton');
        Object.assign(btn.style, {
            flex: '1', padding: '8px', backgroundColor: '#666', color: '#aaa',
            border: 'none', borderRadius: '6px', cursor: 'not-allowed',
            fontWeight: 'bold', fontSize: '14px', transition: 'all 0.3s'
        });
        btn.disabled = true; btn.onclick = mainProcess;
        controls.appendChild(input); controls.appendChild(btn);

        const runControls = document.createElement('div');
        runControls.id = 'af3-run-controls';
        Object.assign(runControls.style, { display: 'none', gap: '8px' });

        const pauseBtn = document.createElement('button');
        pauseBtn.id = 'af3-pause-btn';
        pauseBtn.textContent = t('pauseButton');
        stylePanelButton(pauseBtn, '#5f6368');
        pauseBtn.onclick = togglePause;

        const stopBtn = document.createElement('button');
        stopBtn.id = 'af3-stop-btn';
        stopBtn.textContent = t('stopButton');
        stylePanelButton(stopBtn, '#d93025');
        stopBtn.onclick = requestStop;

        runControls.appendChild(pauseBtn);
        runControls.appendChild(stopBtn);

        const footer = document.createElement('div');
        footer.id = 'af3-footer-msg';
        footer.textContent = t('standbyFooter');
        Object.assign(footer.style, {
            fontSize: '11px', color: '#fdd835', textAlign: 'center', marginTop: '4px'
        });

        const logPanel = document.createElement('div');
        Object.assign(logPanel.style, { borderTop: '1px solid #444', paddingTop: '6px' });

        const logToggle = document.createElement('button');
        logToggle.id = 'af3-log-toggle';
        logToggle.type = 'button';
        logToggle.textContent = `▶ ${t('logLabel')} (0)`;
        Object.assign(logToggle.style, {
            width: '100%',
            padding: '4px 0',
            background: 'transparent',
            border: 'none',
            color: '#9aa0a6',
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 'bold'
        });
        logToggle.onclick = toggleLogPanel;

        const logBody = document.createElement('pre');
        logBody.id = 'af3-log-body';
        Object.assign(logBody.style, {
            display: 'none',
            maxHeight: '120px',
            overflow: 'auto',
            margin: '6px 0 0',
            padding: '8px',
            backgroundColor: 'rgba(0,0,0,0.25)',
            border: '1px solid #3c4043',
            borderRadius: '6px',
            color: '#dfe1e5',
            whiteSpace: 'pre-wrap',
            fontFamily: 'Consolas, monospace',
            fontSize: '10px',
            lineHeight: '1.35'
        });
        logPanel.appendChild(logToggle);
        logPanel.appendChild(logBody);

        container.appendChild(header); container.appendChild(languageRow); container.appendChild(statusRow);
        container.appendChild(controls); container.appendChild(runControls);
        container.appendChild(footer); container.appendChild(logPanel);
        shadow.appendChild(container);
        document.body.appendChild(host);
        makeDraggable(host, header);
        renderLogPanel();
        updateRunControls();
        applyLanguage();
    }

    // --- 状态检测 & 模式判断 ---
    let currentMode = 'NONE';

    function checkSystemStatus() {
        const btn = getUiElement('af3-v20-btn');
        const light = getUiElement('af3-status-light');
        const text = getUiElement('af3-status-text');
        const footer = getUiElement('af3-footer-msg');

        if (!btn || !light || !text || isRunning) return;

        const activeTab = document.querySelector('button[aria-selected="true"], div[aria-selected="true"]');
        const tabName = activeTab ? activeTab.textContent.toLowerCase() : "";

        if (tabName.includes('draft')) {
            currentMode = 'DRAFT';
            light.style.backgroundColor = '#00e676'; // Green
            light.style.boxShadow = '0 0 8px #00e676';
            text.textContent = t('readyDraftStatus'); text.style.color = '#00e676';
            footer.textContent = t('modeDraftFooter');
            btn.disabled = false; btn.style.backgroundColor = '#1a73e8'; btn.style.color = 'white'; btn.style.cursor = 'pointer';
        } else if (tabName.includes('failed')) {
            currentMode = 'FAILED';
            light.style.backgroundColor = '#2979ff'; // Blue
            light.style.boxShadow = '0 0 8px #2979ff';
            text.textContent = t('readyFailedStatus'); text.style.color = '#2979ff';
            footer.textContent = t('modeFailedFooter');
            btn.disabled = false; btn.style.backgroundColor = '#1565c0'; btn.style.color = 'white'; btn.style.cursor = 'pointer';
        } else {
            currentMode = 'NONE';
            light.style.backgroundColor = '#f44336'; // Red
            light.style.boxShadow = '0 0 8px #f44336';
            text.textContent = t('standbyStatus'); text.style.color = '#ef5350';
            footer.textContent = t('standbyFooter');
            btn.disabled = true; btn.style.backgroundColor = '#444'; btn.style.color = '#888'; btn.style.cursor = 'not-allowed';
        }
    }

    // --- 主入口 ---
    async function mainProcess() {
        if (isRunning) return;

        const countInput = getUiElement('af3-v20-count');
        const requestedJobs = parseInt(countInput.value, 10) || 10;
        const maxJobs = confirmStart(requestedJobs);
        if (!maxJobs) return;

        if (currentMode === 'DRAFT') {
            await runDraftSubmission(maxJobs);
        } else if (currentMode === 'FAILED') {
            await runFailedReprocessing(maxJobs);
        }
    }

    // --- 模式 A: 草稿提交 ---
    async function runDraftSubmission(maxJobs) {
        startRunProgress(maxJobs);
        setRunningState(true);
        let finalStatus = 'completed';
        let finalMessage = '';
        try {
            for (let i = 1; i <= maxJobs; i++) {
                await waitIfPaused();
                setProgressCurrent(i);
                updateBtnText(`${i} / ${maxJobs}`);
                const rows = getRows();
                addLog(t('draftProgress', { current: i, total: maxJobs, rows: rows.length }));
                if (rows.length === 0) {
                    finalMessage = t('listEmptyDetail');
                    addLog(t('listEmptyLog'), 'warn');
                    break;
                }
                const taskLabel = getTaskLabel(rows[0], `Draft ${i}`);
                const firstRowText = rows[0].textContent.trim();

                simulateClick(rows[0], 'rgba(0,0,255,0.2)');
                await controlledSleep(500);

                const continueBtn = findButtonByText("Continue and preview job");
                if (continueBtn) {
                    addLog(t('foundContinue'));
                    simulateClick(continueBtn, 'rgba(0,255,0,0.3)');
                    await controlledSleep(WAIT_FOR_MODAL);
                } else {
                    const reason = t('missingContinue');
                    addLog(reason, 'warn');
                    recordProgressResult('skipped', { label: taskLabel, reason });
                    continue;
                }

                let confirmBtn = findButtonByText("Confirm and submit");
                if (!confirmBtn) {
                     if (document.body.innerText.includes("Daily quota")) throw new Error(t('quotaFull'));
                     const reason = t('missingConfirm');
                     addLog(reason, 'warn');
                     recordProgressResult('skipped', { label: taskLabel, reason });
                     continue;
                }
                addLog(t('foundConfirm'));
                simulateClick(confirmBtn, 'rgba(0,255,0,0.3)');

                updateBtnText('Verifying...');
                let submitted = false;
                for (let retry = 0; retry < 60; retry++) {
                    await controlledSleep(500);
                    confirmBtn = findButtonByText("Confirm and submit");
                    if (confirmBtn && retry % 3 === 0) simulateClick(confirmBtn);

                    const rowsNow = getRows();
                    if (rowsNow.length === 0 || rowsNow[0].textContent.trim() !== firstRowText) {
                        addLog(t('draftDone', { index: i }));
                        recordProgressResult('success');
                        submitted = true;
                        break;
                    }
                }
                if (!submitted) {
                    const reason = t('draftUnconfirmed', { index: i });
                    addLog(reason, 'warn');
                    recordProgressResult('error', { label: taskLabel, reason });
                }
            }
        } catch (e) {
            finalStatus = isUserStopError(e) ? 'stopped' : 'error';
            finalMessage = e.message;
            if (finalStatus !== 'stopped') recordProgressResult('error', {
                label: getModeLabel(),
                reason: e.message
            });
            addLog(t('draftStopped', { message: e.message }), isUserStopError(e) ? 'warn' : 'error');
        } finally {
            setRunningState(false);
            finishRunProgress(finalStatus, finalMessage);
        }
    }

    // --- 模式 B: 失败重跑 (修复版) ---
    async function runFailedReprocessing(maxJobs) {
        startRunProgress(maxJobs);
        setRunningState(true);
        let finalStatus = 'completed';
        let finalMessage = '';
        try {
            for (let i = 0; i < maxJobs; i++) {
                await waitIfPaused();
                setProgressCurrent(i + 1);
                updateBtnText(`Job ${i + 1} / ${maxJobs}`);
                addLog(t('failedProgress', { current: i + 1, total: maxJobs }));

                // 1. 确保在 Failed 页面
                await backToFailedTab();
                await controlledSleep(1500);

                const rows = getRows();
                if (i >= rows.length) {
                    finalMessage = t('failedAllDoneDetail');
                    addLog(t('failedAllDoneLog'));
                    break;
                }
                const targetRow = rows[i];
                const taskLabel = getTaskLabel(targetRow, `Failed job ${i + 1}`);
                targetRow.scrollIntoView({behavior: "auto", block: "center"});

                // 2. 点击菜单 (3个点)
                const menuClicked = await clickMenuOnRow(targetRow);
                if (!menuClicked) {
                    const reason = t('missingMenu', { index: i + 1 });
                    addLog(reason, 'warn');
                    recordProgressResult('skipped', { label: taskLabel, reason });
                    continue;
                }
                // 等待菜单弹出，这里多给一点时间
                await controlledSleep(800);

                // 3. 【核心修复】点击 Clone
                const cloneClicked = await clickCloneOption();
                if (!cloneClicked) {
                    const reason = t('missingClone', { index: i + 1 });
                    addLog(reason, 'warn');
                    recordProgressResult('skipped', { label: taskLabel, reason });
                    // 点击 body 关闭可能已打开的菜单
                    document.body.click();
                    await controlledSleep(500);
                    continue;
                }

                // 4. 等待跳转
                updateBtnText("Cloning...");
                await controlledSleep(WAIT_FOR_PAGE_LOAD);

                // 5. 点击 Continue
                let continueBtn = null;
                for(let w=0; w<15; w++) { // 7.5秒轮询
                    await controlledSleep(500);
                    continueBtn = findButtonByText("Continue and preview job");
                    if(continueBtn) break;
                }

                if (!continueBtn) {
                    const reason = t('missingCloneContinue');
                    addLog(reason, 'warn');
                    recordProgressResult('skipped', { label: taskLabel, reason });
                    continue;
                }
                addLog(t('foundContinue'));
                simulateClick(continueBtn);
                await controlledSleep(WAIT_FOR_MODAL);

                // 6. 点击 Confirm
                let confirmBtn = findButtonByText("Confirm and submit");
                if (!confirmBtn) {
                     if (document.body.innerText.includes("Daily quota")) throw new Error(t('quotaFull'));
                     if (continueBtn) simulateClick(continueBtn); // 再次尝试点击continue
                     await controlledSleep(1000);
                     confirmBtn = findButtonByText("Confirm and submit");
                     if (!confirmBtn) throw new Error(t('missingConfirmError'));
                }
                addLog(t('foundConfirm'));
                simulateClick(confirmBtn);

                // 7. 提交后等待
                updateBtnText("Submitted...");
                addLog(t('failedSubmitted', { index: i + 1 }));
                recordProgressResult('success');
                await controlledSleep(2500);
            }

        } catch (e) {
            finalStatus = isUserStopError(e) ? 'stopped' : 'error';
            finalMessage = e.message;
            if (finalStatus !== 'stopped') recordProgressResult('error', {
                label: getModeLabel(),
                reason: e.message
            });
            addLog(t('failedStopped', { message: e.message }), isUserStopError(e) ? 'warn' : 'error');
        } finally {
            setRunningState(false);
            finishRunProgress(finalStatus, finalMessage);
        }
    }

    // --- 辅助状态管理 ---
    function setRunningState(state) {
        isRunning = state;
        shouldStop = false;
        isPaused = false;
        const btn = getUiElement('af3-v20-btn');
        const input = getUiElement('af3-v20-count');
        if (btn) {
            if (!state) {
                btn.textContent = t('startButton');
                btn.disabled = false;
                if (input) input.disabled = false;
                checkSystemStatus();
            } else {
                btn.disabled = true;
                if (input) input.disabled = true;
                updateBtnText(t('runningButton'));
            }
        }
        updateRunControls();
        addLog(state ? t('runStarted') : t('runEnded'));
    }

    function updateRunControls() {
        const runControls = getUiElement('af3-run-controls');
        const pauseBtn = getUiElement('af3-pause-btn');
        const stopBtn = getUiElement('af3-stop-btn');

        if (runControls) runControls.style.display = isRunning ? 'flex' : 'none';
        if (pauseBtn) {
            pauseBtn.textContent = isPaused ? t('resumeButton') : t('pauseButton');
            pauseBtn.style.backgroundColor = isPaused ? '#188038' : '#5f6368';
            pauseBtn.disabled = !isRunning || shouldStop;
            pauseBtn.style.opacity = pauseBtn.disabled ? '0.6' : '1';
        }
        if (stopBtn) {
            stopBtn.disabled = !isRunning || shouldStop;
            stopBtn.style.opacity = stopBtn.disabled ? '0.6' : '1';
            stopBtn.style.cursor = stopBtn.disabled ? 'not-allowed' : 'pointer';
        }
    }

    function updateBtnText(text) {
        const btn = getUiElement('af3-v20-btn');
        if (btn) btn.textContent = text;
    }

    function boot() {
        ensureUI();

        setInterval(ensureUI, 1000);
        setInterval(checkSystemStatus, 500);

        const observer = new MutationObserver(() => {
            if (!getPanelHost()) ensureUI();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        window.addEventListener('pageshow', ensureUI);
        document.addEventListener('visibilitychange', ensureUI);
    }

    function bootWhenReady() {
        if (document.documentElement && document.body) {
            boot();
        } else {
            setTimeout(bootWhenReady, 50);
        }
    }

    bootWhenReady();
})();
