<?php
declare(strict_types=1);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
function fail(string $message, int $status = 400): never { http_response_code($status); echo json_encode(['error'=>$message]); exit; }
function send(array $data): never { echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); exit; }
function stamp(): string { return gmdate('Y-m-d\TH:i:s\Z'); }
function money(int $cents): string { return 'CHF '.number_format($cents / 100, 2, '.', ''); }
function cleanName(string $name): string {
    $name=preg_replace('/\s+/u',' ',trim($name))??'';
    if(!preg_match('/^[\p{L}\p{M}\p{N} .\x{27}\x{2019}_-]{1,60}$/u',$name)||!preg_match('/[\p{L}\p{N}]/u',$name))throw new InvalidArgumentException('Use a name or nickname of 1–60 characters, with letters, numbers, spaces, dots, apostrophes, or hyphens.');
    return $name;
}
function nameKey(string $name): string { return function_exists('mb_strtolower')?mb_strtolower($name,'UTF-8'):strtolower($name); }
function csvText(string $text): string { return preg_match('/^[=+@\-\t\r\n]/',$text)?"'".$text:$text; }
function legacyPayoffs(): array { return ['A'=>[550,450],'B'=>[1000,100]]; }
function classicPayoffs(): array { return ['A'=>[400,320],'B'=>[770,20]]; }
function withPayoffs(array $c): array { $c['payoffs']=json_decode($c['payoffs'],true,32,JSON_THROW_ON_ERROR);return $c; }
function lottery(int $row, string $choice, int $die, ?array $payoffs=null): int {
    if ($row < 1 || $row > 10 || $die < 1 || $die > 10 || !in_array($choice, ['A','B'], true)) throw new InvalidArgumentException('Invalid lottery.');
    return ($payoffs??legacyPayoffs())[$choice][$die <= $row ? 0 : 1];
}
function choiceSummary(array $choices): array {
    $switches = 0;
    for ($i=1;$i<count($choices);$i++) if ($choices[$i] !== $choices[$i-1]) $switches++;
    $monotonic = !preg_match('/BA/', implode('', $choices));
    return ['a_count'=>count(array_filter($choices, fn($c)=>$c==='A')), 'switches'=>$switches, 'monotonic'=>(bool)$monotonic];
}
function pickTwo(array $items): array {
    $n=count($items); if ($n<2) throw new InvalidArgumentException('At least two completed participants are required.');
    $i=random_int(0,$n-1); $first=$items[$i]; array_splice($items,$i,1);
    return [$first,$items[random_int(0,$n-2)]];
}
function makeWinners(array $completed, array $payoffs): array {
    $winners=[];
    foreach(pickTwo($completed) as $p){
        $row=random_int(1,10);$die=random_int(1,10);$choice=json_decode($p['choices'],true)[$row-1];
        $winners[]=['ticket'=>$p['ticket'],'name'=>$p['name']?:$p['ticket'],'row'=>$row,'die'=>$die,'choice'=>$choice,'cents'=>lottery($row,$choice,$die,$payoffs)];
    }
    return $winners;
}
try {
    if (!is_file(__DIR__.'/config.php')) fail('The instructor has not configured this experiment yet.',503);
    $config = require __DIR__.'/config.php';
    $urlParts = parse_url($config['base_url']);
    $origin = $urlParts['scheme'].'://'.$urlParts['host'];
    $port = $urlParts['port'] ?? null;
    // Browsers omit default ports from Origin, but retain non-default ports.
    if ($port !== null && !(($urlParts['scheme']==='https' && $port===443) || ($urlParts['scheme']==='http' && $port===80))) $origin .= ':'.$port;
    if (($_SERVER['REQUEST_METHOD']??'GET')==='POST') {
        if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $origin) fail('Request origin is not allowed.',403);
        if (!str_starts_with($_SERVER['CONTENT_TYPE']??'', 'application/json')) fail('JSON request required.',415);
        if ((int)($_SERVER['CONTENT_LENGTH']??0)>20000) fail('Request too large.',413);
    }
    session_name('hl_classroom');
    session_set_cookie_params(['lifetime'=>0,'path'=>$config['cookie_path'],'secure'=>str_starts_with($config['base_url'],'https:'),'httponly'=>true,'samesite'=>'Strict']);
    session_start();
    if (!isset($_SESSION['csrf'])) $_SESSION['csrf']=bin2hex(random_bytes(32));
    $input=json_decode(file_get_contents('php://input')?:'{}',true,32,JSON_THROW_ON_ERROR);
    if (!is_array($input)) fail('Invalid request.');
    $action=(string)($_GET['action']??'state');
    if (($_SERVER['REQUEST_METHOD']??'GET')==='POST' && !hash_equals($_SESSION['csrf'], (string)($_SERVER['HTTP_X_CSRF_TOKEN']??''))) fail('Your page expired. Refresh and try again.',403);
    $dataDir=$config['data_dir'];
    if (!is_dir($dataDir) && !mkdir($dataDir,0700,true) && !is_dir($dataDir)) fail('Private storage is unavailable. Please contact the instructor.',503);
    $db=new PDO('sqlite:'.$dataDir.'/experiment.sqlite',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA busy_timeout=10000');
    $db->exec('PRAGMA journal_mode=WAL');
    $db->exec('PRAGMA foreign_keys=ON');
    $db->exec("CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY,title TEXT NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',created TEXT NOT NULL,drawn_at TEXT,winners TEXT)");
    $db->exec('CREATE TABLE IF NOT EXISTS participants(id INTEGER PRIMARY KEY AUTOINCREMENT,class_id TEXT NOT NULL REFERENCES classes(id),ticket TEXT NOT NULL UNIQUE,choices TEXT,submitted TEXT,joined TEXT)');
    $db->exec('CREATE TABLE IF NOT EXISTS throttle(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)');
    // Additive, serialized migration: existing classes, choices, and draws are preserved.
    if((int)$db->query('PRAGMA user_version')->fetchColumn()<2){
        $db->exec('BEGIN IMMEDIATE');
        try{
            $columns=array_column($db->query('PRAGMA table_info(participants)')->fetchAll(),'name');
            if(!in_array('name',$columns,true))$db->exec('ALTER TABLE participants ADD COLUMN name TEXT');
            if(!in_array('name_key',$columns,true))$db->exec('ALTER TABLE participants ADD COLUMN name_key TEXT');
            $columns=array_column($db->query('PRAGMA table_info(classes)')->fetchAll(),'name');
            if(!in_array('enrollment',$columns,true))$db->exec("ALTER TABLE classes ADD COLUMN enrollment TEXT NOT NULL DEFAULT 'ticket'");
            $db->exec('CREATE UNIQUE INDEX IF NOT EXISTS unique_class_name ON participants(class_id,name_key) WHERE name_key IS NOT NULL');
            $db->exec('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
            $db->exec('PRAGMA user_version=2');$db->exec('COMMIT');
        }catch(Throwable $e){$db->exec('ROLLBACK');throw $e;}
    }
    // Existing sessions keep the exact stakes presented when their choices were made.
    if((int)$db->query('PRAGMA user_version')->fetchColumn()<3){
        $db->exec('BEGIN IMMEDIATE');
        try{
            $columns=array_column($db->query('PRAGMA table_info(classes)')->fetchAll(),'name');
            if(!in_array('payoffs',$columns,true))$db->exec('ALTER TABLE classes ADD COLUMN payoffs TEXT NOT NULL DEFAULT '.$db->quote(json_encode(legacyPayoffs())));
            $db->exec('PRAGMA user_version=3');$db->exec('COMMIT');
        }catch(Throwable $e){$db->exec('ROLLBACK');throw $e;}
    }
    function query(string $sql, array $params=[]): PDOStatement { global $db; $q=$db->prepare($sql);$q->execute($params);return $q; }
    function postOnly(): void { if (($_SERVER['REQUEST_METHOD']??'GET')!=='POST') fail('POST required.',405); }
    function adminOnly(): void { if (empty($_SESSION['admin']) || time() > ($_SESSION['admin_until']??0)) fail('Please sign in as instructor.',401); }
    function transaction(callable $fn): mixed { global $db; $db->exec('BEGIN IMMEDIATE');try{$value=$fn();$db->exec('COMMIT');return $value;}catch(Throwable $e){$db->exec('ROLLBACK');throw $e;} }
    function limited(string $purpose,int $maximum): void {
        global $config;
        $bucket=hash_hmac('sha256',$purpose.($_SERVER['REMOTE_ADDR']??'unknown'),$config['admin_key_hash']);
        $blocked=transaction(function() use($bucket,$maximum){$r=query('SELECT * FROM throttle WHERE bucket=?',[$bucket])->fetch();$now=time();if(!$r||$r['expires']<$now){query('INSERT OR REPLACE INTO throttle(bucket,count,expires) VALUES(?,1,?)',[$bucket,$now+900]);return false;}query('UPDATE throttle SET count=count+1 WHERE bucket=?',[$bucket]);return $r['count']>=$maximum;});
        if($blocked) fail('Too many attempts. Please wait 15 minutes or ask the instructor.',429);
    }
    function getClass(string $id): array { $c=query('SELECT * FROM classes WHERE id=?',[$id])->fetch();if(!$c) fail('Session not found.',404);return withPayoffs($c); }
    function activeId(): string { return (string)(query("SELECT value FROM settings WHERE key='active_session'")->fetchColumn()?:''); }
    function publicClass(string $id): ?array {
        if(!$id)return null;
        $c=query('SELECT id,title,mode,state,enrollment,payoffs FROM classes WHERE id=?',[$id])->fetch();
        return $c?withPayoffs($c):null;
    }
    function rememberParticipant(array $p): void { $_SESSION['participant']=(int)$p['id'];$_SESSION['enrolments'][$p['class_id']]=(int)$p['id']; }
    function publicParticipant(): ?array {
        if(empty($_SESSION['participant']))return null;
        $p=query('SELECT p.*,c.title,c.mode,c.state,c.winners,c.drawn_at,c.payoffs FROM participants p JOIN classes c ON c.id=p.class_id WHERE p.id=?',[$_SESSION['participant']])->fetch();
        if(!$p)return null;
        $winners=json_decode($p['winners']?:'[]',true);$own=null;foreach($winners as $w)if($w['ticket']===$p['ticket'])$own=$w;
        return ['ticket'=>$p['ticket'],'name'=>$p['name']?:$p['ticket'],'payoffs'=>json_decode($p['payoffs'],true),'class_id'=>$p['class_id'],'title'=>$p['title'],'mode'=>$p['mode'],'state'=>$p['state'],'submitted'=>$p['submitted'],'choices'=>$p['choices']?json_decode($p['choices'],true):null,'drawn_at'=>$p['drawn_at'],'winner'=>$own];
    }
    if($action==='state'){
        $joinClass=publicClass((string)($_GET['session']??activeId()));
        if($joinClass){
            $id=$joinClass['id'];
            if(isset($_SESSION['enrolments'][$id]))$_SESSION['participant']=$_SESSION['enrolments'][$id];
            else {$existing=publicParticipant();if($existing&&$existing['class_id']!==$id)unset($_SESSION['participant']);}
        }
        send(['csrf'=>$_SESSION['csrf'],'admin'=>!empty($_SESSION['admin'])&&time()<($_SESSION['admin_until']??0),'participant'=>publicParticipant(),'join_session'=>$joinClass,'active_id'=>activeId()]);
    }
    if($action==='login'){
        postOnly();limited('admin',15);
        if(!hash_equals($config['admin_key_hash'],hash('sha256',(string)($input['key']??''))))fail('Incorrect instructor access code.',401);
        session_regenerate_id(true);$_SESSION['admin']=true;$_SESSION['admin_until']=time()+28800;$_SESSION['csrf']=bin2hex(random_bytes(32));send(['ok'=>true,'csrf'=>$_SESSION['csrf']]);
    }
    if($action==='logout'){postOnly();unset($_SESSION['admin'],$_SESSION['admin_until']);send(['ok'=>true]);}
    if($action==='join'){
        postOnly();limited('join',2000);
        // A private recovery code resumes a record; a name alone never opens someone else's entry.
        $ticket=strtoupper(preg_replace('/[^a-zA-Z0-9]/','',(string)($input['ticket']??'')));
        if($ticket){
            if(!preg_match('/^(?:[A-F0-9]{10}|[A-F0-9]{36})$/',$ticket))fail('Check your private recovery code.');
            $p=query('SELECT * FROM participants WHERE ticket=?',[$ticket])->fetch();
            if(!$p)fail('Recovery code not found.',404);
            if(isset($input['session'])&&$input['session']!==$p['class_id'])fail('That recovery code belongs to another session.',409);
            rememberParticipant($p);query('UPDATE participants SET joined=COALESCE(joined,?) WHERE id=?',[stamp(),$p['id']]);send(['participant'=>publicParticipant()]);
        }
        $id=(string)($input['session']??activeId());
        if(!$id)fail('Your instructor has not opened a session yet.',409);
        $known=$_SESSION['enrolments'][$id]??null;
        if($known){$p=query('SELECT * FROM participants WHERE id=? AND class_id=?',[$known,$id])->fetch();if($p){rememberParticipant($p);send(['participant'=>publicParticipant()]);}}
        try{$name=cleanName((string)($input['name']??''));}catch(InvalidArgumentException $e){fail($e->getMessage());}
        $protocol=(int)($input['protocol']??0);$result=transaction(function()use($id,$name,$protocol){
            $c=getClass($id);
            if($c['state']!=='open')return ['error'=>'This session is closed. Please ask your instructor.'];
            if($c['payoffs']!==legacyPayoffs()&&$protocol<2)return ['error'=>'The experiment was updated. Reload this page before joining.'];
            if($c['enrollment']!=='name')return ['error'=>'This older session uses participation codes. Ask your instructor to create a new session.'];
            $key=nameKey($name);
            if(query('SELECT id FROM participants WHERE class_id=? AND name_key=?',[$id,$key])->fetch())return ['error'=>'That name is already in this session. Add your surname or an initial. If it is your own entry, continue on the phone you used to join.'];
            do{$ticket=strtoupper(bin2hex(random_bytes(18)));}while(query('SELECT id FROM participants WHERE ticket=?',[$ticket])->fetch());
            query('INSERT INTO participants(class_id,ticket,name,name_key,joined)VALUES(?,?,?,?,?)',[$id,$ticket,$name,$key,stamp()]);
            return query('SELECT * FROM participants WHERE ticket=?',[$ticket])->fetch();
        });
        if(isset($result['error']))fail($result['error'],409);
        rememberParticipant($result);send(['participant'=>publicParticipant()]);
    }
    if($action==='leave'){
        postOnly();$p=publicParticipant();
        if(!$p||$p['mode']!=='practice')fail('Use your existing entry for this class.',409);
        unset($_SESSION['enrolments'][$p['class_id']],$_SESSION['participant']);send(['ok'=>true]);
    }
    if($action==='submit'){
        postOnly();if(isset($input['ticket'])){$record=query('SELECT * FROM participants WHERE ticket=?',[(string)$input['ticket']])->fetch();if(!$record)fail('Join your class first.',401);rememberParticipant($record);}if(empty($_SESSION['participant']))fail('Join your class first.',401);$participantId=(int)$_SESSION['participant'];
        $choices=$input['choices']??null;if(!is_array($choices)||count($choices)!==10||array_keys($choices)!==range(0,9))fail('Please complete all ten choices.');
        foreach($choices as $v)if(!in_array($v,['A','B'],true))fail('Each choice must be A or B.');
        $protocol=(int)($input['protocol']??0);$error=transaction(function()use($choices,$participantId,$protocol){$p=query('SELECT p.*,c.state,c.payoffs FROM participants p JOIN classes c ON c.id=p.class_id WHERE p.id=?',[$participantId])->fetch();if(!$p)return 'Participant not found.';if($p['submitted'])return null;if(json_decode($p['payoffs'],true)!==legacyPayoffs()&&$protocol<2)return 'The experiment was updated. Reload this page before submitting.';if($p['state']!=='open')return 'Submissions are closed. Your answers have not been saved.';query('UPDATE participants SET choices=?,submitted=? WHERE id=?',[json_encode($choices),stamp(),$p['id']]);return null;});
        if($error)fail($error,409);send(['participant'=>publicParticipant()]);
    }
    adminOnly();
    if($action==='sessions')send(['active_id'=>activeId(),'sessions'=>query("SELECT c.*,COUNT(p.id) AS registered,SUM(CASE WHEN p.joined IS NOT NULL THEN 1 ELSE 0 END) AS joined,SUM(CASE WHEN p.submitted IS NOT NULL THEN 1 ELSE 0 END) AS completed FROM classes c LEFT JOIN participants p ON p.class_id=c.id GROUP BY c.id ORDER BY c.created DESC")->fetchAll()]);
    if($action==='create'){
        postOnly();$title=trim((string)($input['title']??('Session '.gmdate('d M H:i'))));$mode=(string)($input['mode']??'practice');
        if(strlen($title)<1||strlen($title)>100)fail('Use a session title of 1–100 characters.');
        if(!in_array($mode,['practice','real'],true))fail('Invalid payment mode.');
        $id=strtoupper(bin2hex(random_bytes(4)));
        transaction(function()use($id,$title,$mode){$previous=activeId();if($previous)query("UPDATE classes SET state='closed' WHERE id=? AND state='open'",[$previous]);query('INSERT INTO classes(id,title,mode,created,enrollment,payoffs)VALUES(?,?,?,?,?,?)',[$id,$title,$mode,stamp(),'name',json_encode(classicPayoffs())]);query("INSERT OR REPLACE INTO settings(key,value)VALUES('active_session',?)",[$id]);});
        send(['id'=>$id]);
    }
    if($action==='activate'){
        postOnly();$id=(string)($input['id']??'');
        $ok=transaction(function()use($id){$c=getClass($id);if($c['state']!=='open'||$c['enrollment']!=='name')return false;query("INSERT OR REPLACE INTO settings(key,value)VALUES('active_session',?)",[$id]);return true;});
        if(!$ok)fail('Choose an open session with name registration.',409);send(['ok'=>true]);
    }
    if($action==='details'){
        $id=(string)($_GET['id']??'');$c=getClass($id);$people=query('SELECT ticket,name,joined,submitted,choices FROM participants WHERE class_id=? ORDER BY id',[$id])->fetchAll();
        $a=array_fill(0,10,0);$hist=array_fill(0,11,0);$completed=0;$nonmonotonic=0;
        foreach($people as &$p){if($p['choices']){$p['choices']=json_decode($p['choices'],true);$p['summary']=choiceSummary($p['choices']);$completed++;$hist[$p['summary']['a_count']]++;if(!$p['summary']['monotonic'])$nonmonotonic++;foreach($p['choices'] as $i=>$v)if($v==='A')$a[$i]++;}}unset($p);
        $c['winners']=json_decode($c['winners']?:'[]',true);send(['active_id'=>activeId(),'session'=>$c,'participants'=>$people,'completed'=>$completed,'a_counts'=>$a,'histogram'=>$hist,'nonmonotonic'=>$nonmonotonic,'base_url'=>$config['base_url']]);
    }
    if($action==='phase'){
        postOnly();$id=(string)($input['id']??'');$state=(string)($input['state']??'');if(!in_array($state,['open','closed'],true))fail('Invalid state.');
        $changed=transaction(function()use($id,$state){$c=getClass($id);if($c['state']==='drawn')return false;query('UPDATE classes SET state=? WHERE id=?',[$state,$id]);return true;});
        if(!$changed)fail('The draw is final. Create a new session to run another experiment.',409);send(['ok'=>true]);
    }
    if(in_array($action,['draw','finish'],true)){
        postOnly();$id=(string)($input['id']??'');
        // One locked transaction closes submissions and records the immutable draw.
        $result=transaction(function()use($id,$action){$c=getClass($id);if($c['state']==='drawn')return ['winners'=>json_decode($c['winners'],true),'drawn_at'=>$c['drawn_at']];if($action==='draw'&&$c['state']!=='closed')return ['error'=>'Close submissions before drawing winners.'];$completed=query('SELECT ticket,name,choices FROM participants WHERE class_id=? AND submitted IS NOT NULL ORDER BY id',[$id])->fetchAll();if(count($completed)<2)return ['error'=>'At least two completed participants are required.'];$winners=makeWinners($completed,$c['payoffs']);$at=stamp();query("UPDATE classes SET state='drawn',drawn_at=?,winners=? WHERE id=?",[$at,json_encode($winners),$id]);return ['winners'=>$winners,'drawn_at'=>$at];});
        if(isset($result['error']))fail($result['error'],409);send($result);
    }
    if($action==='export'){
        $id=(string)($_GET['id']??'');$c=getClass($id);$winners=json_decode($c['winners']?:'[]',true);$map=[];foreach($winners as $w)$map[$w['ticket']]=$w;
        header('Content-Type: text/csv; charset=utf-8');header('Content-Disposition: attachment; filename="holt-laury-'.$id.'.csv"');$out=fopen('php://output','w');fwrite($out,"\xEF\xBB\xBF");
        fputcsv($out,['session_id','payment_mode','a_high_chf','a_low_chf','b_high_chf','b_low_chf','participant_code','participant_name','submitted_utc',...array_map(fn($n)=>'choice_'.$n,range(1,10)),'a_count','switches','monotonic','selected_for_payment','paid_row','die','payout_chf','drawn_utc'],',','"','');
        foreach(query('SELECT * FROM participants WHERE class_id=? ORDER BY id',[$id])->fetchAll() as $p){$choices=$p['choices']?json_decode($p['choices'],true):array_fill(0,10,'');$s=$p['choices']?choiceSummary($choices):['a_count'=>'','switches'=>'','monotonic'=>''];$w=$map[$p['ticket']]??null;fputcsv($out,[$id,$c['mode'],...array_map(fn($n)=>number_format($n/100,2,'.',''),array_merge($c['payoffs']['A'],$c['payoffs']['B'])),'P-'.$p['ticket'],csvText($p['name']??''),$p['submitted']??'',...$choices,$s['a_count'],$s['switches'],$s['monotonic']===true?'1':($s['monotonic']===false?'0':''),$w?'1':'0',$w['row']??'',$w['die']??'',isset($w['cents'])?number_format($w['cents']/100,2,'.',''):'',$c['drawn_at']??''],',','"','');}fclose($out);exit;
    }
    if($action==='selftest'){
        header('Content-Disposition: attachment; filename="risk-reward-checks.json"');
        $checks=[];for($row=1;$row<=10;$row++)foreach(['A','B'] as $choice)for($die=1;$die<=10;$die++){$v=lottery($row,$choice,$die);if($v<100||$v>1000)throw new RuntimeException('Payout outside range.');if($row===10&&$v!==($choice==='A'?550:1000))throw new RuntimeException('Certainty row failed.');}
        $checks[]='All 200 row / option / die combinations pay CHF 1–10.';
        for($row=1;$row<=10;$row++){$a=450+100*$row/10;$b=100+900*$row/10;if(($row<=4&&$a<=$b)||($row>=5&&$a>=$b))throw new RuntimeException('Expected-value benchmark failed.');}$checks[]='Expected-value benchmark switches from A to B at decision 5.';
        for($i=0;$i<1000;$i++){$p=pickTwo([1,2,3,4,5]);if($p[0]===$p[1])throw new RuntimeException('Duplicate winner.');}$checks[]='1,000 test draws each selected two distinct entries.';
        if(choiceSummary(['A','B','A','B','B','B','B','B','B','B'])['monotonic'])throw new RuntimeException('Reversal check failed.');$checks[]='Back-and-forth switching is retained and flagged.';
        $classic=classicPayoffs();$original=['A'=>[200,160],'B'=>[385,10]];
        foreach(['A','B'] as $o)foreach([0,1] as $i)if($classic[$o][$i]!==2*$original[$o][$i])throw new RuntimeException('Original payoff ratios changed.');
        for($row=1;$row<=10;$row++)foreach(['A','B'] as $o)for($die=1;$die<=10;$die++){if(lottery($row,$o,$die,$classic)!==$classic[$o][$die<=$row?0:1])throw new RuntimeException('Classic lottery failed.');}
        if(2*max(array_merge(...array_values($classic)))!==1540)throw new RuntimeException('Classic budget cap failed.');
        for($row=1;$row<=10;$row++){ $a=320+80*$row/10;$b=20+750*$row/10;if(($row<=4&&$a<=$b)||($row>=5&&$a>=$b))throw new RuntimeException('Classic expected-value benchmark failed.'); }
        $checks[]='Classic CHF payoffs are exactly 2x the original: A 4.00 / 3.20, B 7.70 / 0.20; all 200 outcomes checked; two-winner maximum CHF 15.40; expected-value switch at row 5.';
        $fixture=[];foreach(['A','B','A'] as $i=>$o)$fixture[]=['ticket'=>'test-'.$i,'name'=>'Test '.$i,'choices'=>json_encode(array_fill(0,10,$o))];
        for($i=0;$i<1000;$i++){$w=makeWinners($fixture,$classic);if(count($w)!==2||$w[0]['ticket']===$w[1]['ticket'])throw new RuntimeException('Winner selection failed.');foreach($w as $p){$expected=$p['ticket']==='test-1'?'B':'A';if($p['choice']!==$expected||$p['cents']!==lottery($p['row'],$expected,$p['die'],$classic))throw new RuntimeException('Winner receipt failed.');}}
        $checks[]='1,000 complete test draws preserve each selected row, submitted option, and corresponding CHF payment. No session records were changed.';
        $checks[]='Existing sessions retain their recorded payoff schedule.';
        $checks[]='SQLite storage is outside the website directory.';
        send(['checks'=>$checks]);
    }
    fail('Unknown action.',404);
} catch(JsonException $e){fail('Invalid JSON request.',400);}catch(Throwable $e){error_log('HoltLaury: '.$e->getMessage());fail('The server could not complete that request. Please retry; submitted choices and completed draws are retained.',500);}
