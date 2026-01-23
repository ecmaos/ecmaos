#include "commands.hpp"
#include <unordered_map>
#include <emscripten/console.h>

namespace commands {
    // Command registry
    static const std::unordered_map<std::string, CommandFunction> command_registry = {
        {"ls", ls},
        {"cat", cat},
        {"echo", echo},
        {"rm", rm}
    };

    CommandResult execute_command(const std::string& command) {
        // emscripten_console_log("Command received:");
        // emscripten_console_log(command.c_str());

        // Split command and arguments
        size_t space_pos = command.find(' ');
        std::string cmd = space_pos != std::string::npos ? 
            command.substr(0, space_pos) : command;
        std::string args = space_pos != std::string::npos ? 
            command.substr(space_pos + 1) : "";

        // Look up command in registry
        auto it = command_registry.find(cmd);
        if (it == command_registry.end()) {
            return { -1, "Unknown command" };
        }

        // Execute command
        return it->second(args);
    }
} 