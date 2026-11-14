using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Script.Serialization;

static class AppServer
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly string ThreadId = Guid.NewGuid().ToString();
    static readonly string TurnId = Guid.NewGuid().ToString();

    static void Write(object message)
    {
        Console.WriteLine(Json.Serialize(message));
        Console.Out.Flush();
    }

    static int Main(string[] args)
    {
        if (Environment.GetEnvironmentVariable("ACCESS_TOKEN") != "fixture-access-token" ||
            String.IsNullOrEmpty(Environment.GetEnvironmentVariable("CODEX_HOME")) ||
            !args.Contains("model_providers.openai_chatgpt_plan.base_url=\"https://api.openai.com/v1\"") ||
            !args.Contains("model_providers.openai_chatgpt_plan.env_key=\"ACCESS_TOKEN\"")) return 1;
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            var request = Json.Deserialize<Dictionary<string, object>>(line);
            object id;
            if (!request.TryGetValue("id", out id)) continue;
            string method = (string)request["method"];
            var data = (Dictionary<string, object>)request["params"];
            if (method == "initialize") Write(new { id, result = new { userAgent = "fixture" } });
            else if (method == "thread/start")
            {
                if ((string)data["model"] != "gpt-fixture-desktop" || (string)data["sandbox"] != "read-only" ||
                    (string)data["approvalPolicy"] != "never" || !(bool)data["ephemeral"]) return 2;
                Write(new { id, result = new { thread = new { id = ThreadId } } });
            }
            else if (method == "turn/start")
            {
                if ((string)data["threadId"] != ThreadId || !line.Contains("isolated Codex fixture result")) return 3;
                Write(new { id, result = new { turn = new { id = TurnId } } });
                Write(new { method = "item/agentMessage/delta", @params = new { threadId = ThreadId, turnId = TurnId, delta = "CODEX_FIXTURE_OK" } });
                Write(new { method = "turn/completed", @params = new { threadId = ThreadId, turn = new { id = TurnId, status = "completed" } } });
            }
            else return 4;
        }
        return 0;
    }
}
