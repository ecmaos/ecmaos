#pragma once
#include <string>

namespace commands {
    struct CommandResult {
        int code;
        std::string output;
    };

    // Command function type definition
    typedef CommandResult (*CommandFunction)(const std::string& args);

    // Command functions
    CommandResult ls(const std::string& args);
    CommandResult cat(const std::string& args);
    CommandResult echo(const std::string& args);
    CommandResult rm(const std::string& args);

    // Command registration and execution
    CommandResult execute_command(const std::string& command);
} 